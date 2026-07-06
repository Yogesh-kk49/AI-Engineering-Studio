import React, { useState, useRef, useCallback, useEffect } from 'react';
import api from '../services/api';
import { normalizeRepoUrl } from '../utils/helpers';
import { isAnalysisInProgress } from '../hooks/useAnalyses';

// Mirrors the backend pipeline order; used to pick a short label + icon
// for whatever stage the live-polled row currently reports.
const STAGE_LABELS = {
  Queued:              'Queued…',
  Cloning:             'Cloning…',
  Scanning:            'Scanning…',
  'AI Analysis':       'Analyzing…',
  'Generating Report': 'Reporting…',
};

export default function RepositoryForm({ onAnalysisStarted, toast, findExistingByUrl, onAlreadyScanned, onScanModeChange }) {
  const [repoUrl, setRepoUrl]   = useState('');
  const [loading, setLoading]   = useState(false);
  // "basic"  – GitHub-API-only scan, never clones. Fast (~1-5s).
  // "deep"   – full clone + architecture/quality/security/dependency scan.
  const [scanMode, setScanMode] = useState('basic');
  const [deepScan, setDeepScan] = useState(false); // deep-scan-only: check every file, no sampling cap
  const [stage, setStage]       = useState('');   // current backend status label
  const [percent, setPercent]   = useState(0);     // progress_percent for the fill bar
  // Set when the backend reports "Repository already downloaded" for a
  // Deep Scan request — renders the duplicate-protection choice instead
  // of the normal form until the user picks one.
  const [duplicatePrompt, setDuplicatePrompt] = useState(null); // { repoUrl, options, data }
  const pollRef   = useRef(null);
  const trackedId = useRef(null); // id of the row we're currently polling, once known

  // Lets the parent (Dashboard) know which mode is currently selected, so
  // it can show an accurate time estimate instead of a generic one that
  // doesn't change with the mode actually picked here.
  useEffect(() => {
    onScanModeChange?.(scanMode);
  }, [scanMode, onScanModeChange]);


  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // While the (blocking) POST /api/analyze/ request is in flight, the
  // analysis row already exists in the DB and is being updated stage by
  // stage. Poll for that row's live status + percent right inside the
  // button instead of a static spinner.
  //
  // This used to poll GET /api/analysis/ (the full list) once a second,
  // which re-downloads every analysis ever run — including each one's
  // full report metadata blob — just to read one row's status. On a
  // history of any real size that's easily 1-2MB per tick, so a 20-30s
  // analysis was spending most of its wall-clock time transferring and
  // JSON-parsing megabytes of data it threw away immediately after
  // reading `status`/`progress_percent` off one row.
  //
  // Now: resolve the row id once (cheap, single lightweight lookup), then
  // poll only GET /api/analysis/<id>/progress/, which returns a handful
  // of scalar fields — same lightweight endpoint the step tracker already
  // uses. That's a response measured in bytes, not megabytes.
  const startPolling = useCallback((submittedUrl, submittedAt) => {
    stopPolling();
    trackedId.current = null;
    pollRef.current = setInterval(async () => {
      try {
        if (trackedId.current == null) {
          // Not found yet — match by url + recency until we lock onto an
          // id. This one list call is unavoidable (we don't have an id
          // yet), but it happens at most a couple of times, not every tick.
          const res = await api.get('analysis/');
          const rows = res.data.results || [];
          const row = rows
            .filter(r => r.repo_url === submittedUrl && new Date(r.created_at) >= submittedAt)
            .sort((a, b) => b.id - a.id)[0];
          if (row) {
            trackedId.current = row.id;
            setStage(row.status);
            setPercent(row.progress_percent ?? 0);
          }
          return;
        }

        const res = await api.get(`analysis/${trackedId.current}/progress/`);
        setStage(res.data.status);
        setPercent(res.data.progress_percent ?? 0);
      } catch {
        // transient — keep trying, the next tick will retry
      }
    }, 1000);
  }, [stopPolling]);

  // Actually fires the POST /api/analyze/ request and wires up polling +
  // toasts. Shared by the normal submit path and by the duplicate-protection
  // follow-up once the user picks an option.
  const runAnalysis = async (trimmed, extra = {}) => {
    setLoading(true);
    setStage('Queued');
    setPercent(0);
    const submittedAt = new Date();
    startPolling(trimmed, submittedAt);

    try {
      const res = await api.post('analyze/', {
        repo_url: trimmed, scan_mode: scanMode, deep_scan: deepScan, ...extra,
      });

      if (res.data.duplicate) {
        // Repository already cloned on disk from an earlier Deep Scan —
        // ask the user how to proceed instead of guessing.
        stopPolling();
        setLoading(false);
        setStage('');
        setPercent(0);
        setDuplicatePrompt({ repoUrl: trimmed, options: res.data.options, data: res.data.data });
        return;
      }

      setRepoUrl('');
      const modeLabel = scanMode === 'deep' ? 'Deep scan' : 'Basic scan';
      toast?.success(`${modeLabel} ${res.data.cached ? 'loaded from cache' : 'completed'} for ${res.data.data?.project_name || 'repository'}`);
      onAnalysisStarted?.(res.data.data);
    } catch (err) {
      toast?.error(err?.response?.data?.error || 'Failed to start analysis.');
    } finally {
      stopPolling();
      setLoading(false);
      setStage('');
      setPercent(0);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = repoUrl.trim();
    if (!trimmed)                        { toast?.error('Please enter a GitHub URL.');          return; }
    if (!trimmed.includes('github.com')) { toast?.error('Only GitHub repositories supported.'); return; }

    // ── Already-scanned check ─────────────────────────────────────────
    // If this exact repo (by normalized URL) is already sitting in the
    // history, don't kick off a brand-new pipeline run. Instead surface
    // the existing card and bump it to the top — a "Rescan" button on
    // that card is the explicit way to check for updates.
    const existing = findExistingByUrl?.(trimmed);
    if (existing) {
      setRepoUrl('');
      if (isAnalysisInProgress(existing)) {
        toast?.info(`This repository is already being analyzed (${existing.status}…).`);
      } else {
        toast?.info(`"${existing.project_name || trimmed}" was already scanned — moved to the top.`);
      }
      onAlreadyScanned?.(existing);
      return;
    }

    await runAnalysis(trimmed);
  };

  const resolveDuplicate = async (repoAction) => {
    if (!duplicatePrompt) return;
    const { repoUrl: trimmed } = duplicatePrompt;
    setDuplicatePrompt(null);
    await runAnalysis(trimmed, { repo_action: repoAction });
  };

  const buttonLabel = STAGE_LABELS[stage] || (loading ? 'Submitting…' : 'Analyze');

  // ── Duplicate-protection prompt ─────────────────────────────────────
  if (duplicatePrompt) {
    return (
      <div style={{
        padding: 16, borderRadius: 'var(--radius)', border: '1px solid var(--border)',
        background: 'var(--bg-input)',
      }}>
        <p style={{ margin: 0, marginBottom: 12, fontSize: 13.5, color: 'var(--text-strong)', fontWeight: 600 }}>
          Repository already downloaded
        </p>
        <p style={{ margin: 0, marginBottom: 14, fontSize: 12.5, color: 'var(--text-muted)' }}>
          {duplicatePrompt.data?.project_name || duplicatePrompt.repoUrl} is already cached on disk from a previous Deep Scan.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {duplicatePrompt.options?.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => resolveDuplicate(opt.value)}
              style={{
                padding: '8px 14px', borderRadius: 'var(--radius)', fontSize: 12.5, fontWeight: 600,
                border: '1px solid var(--border-active)', background: 'transparent',
                color: 'var(--text-strong)', cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDuplicatePrompt(null)}
            style={{
              padding: '8px 14px', borderRadius: 'var(--radius)', fontSize: 12.5,
              border: '1px solid transparent', background: 'transparent',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', gap: 10, position: 'relative' }}>
        {/* GitHub icon */}
        <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                      color: 'var(--text-muted)', pointerEvents: 'none' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
        </div>

        <input
          type="text"
          placeholder="https://github.com/owner/repository"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          disabled={loading}
          style={{
            flex: 1, padding: '12px 14px 12px 44px',
            background: 'var(--bg-input)',
            border: `1px solid ${repoUrl ? 'var(--border-active)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', color: 'var(--text-strong)', fontSize: 14,
            transition: 'var(--transition)',
            boxShadow: repoUrl ? '0 0 0 3px rgba(79,126,248,0.08)' : 'none',
          }}
        />

        <button
          type="submit"
          disabled={loading || !repoUrl.trim()}
          style={{
            position: 'relative', overflow: 'hidden',
            padding: '12px 24px', borderRadius: 'var(--radius)',
            background: loading ? 'rgba(79,126,248,0.5)' : 'linear-gradient(135deg,#4f7ef8,#2563eb)',
            color: '#fff', fontSize: 14, fontWeight: 600,
            opacity: !repoUrl.trim() ? 0.5 : 1,
            boxShadow: loading ? 'none' : '0 2px 8px rgba(79,126,248,0.35)',
            cursor: loading || !repoUrl.trim() ? 'not-allowed' : 'pointer',
            transition: 'var(--transition)', whiteSpace: 'nowrap',
            minWidth: 132,
          }}
        >
          {/* Fill bar tracking live progress_percent, sits behind the label */}
          {loading && (
            <span style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${Math.max(percent, 6)}%`,
              background: 'rgba(255,255,255,0.18)',
              transition: 'width 0.4s ease',
            }} />
          )}

          <span style={{ position: 'relative', display: 'flex', alignItems: 'center',
                         justifyContent: 'center', gap: 8 }}>
            {loading ? (
              <>
                <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)',
                               borderTopColor: '#fff', borderRadius: '50%',
                               animation: 'spin 0.7s linear infinite', display: 'inline-block',
                               flexShrink: 0 }} />
                <span>{buttonLabel}</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Analyze
              </>
            )}
          </span>
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        {/* Basic vs Deep scan mode — Basic (default) never clones the repo
            and returns in a few seconds; Deep clones once, caches it on
            disk, and reuses that cache on every future scan/rescan/download. */}
        <div role="radiogroup" aria-label="Scan mode" style={{ display: 'flex', gap: 4,
             padding: 3, borderRadius: 'var(--radius)', background: 'var(--bg-input)',
             border: '1px solid var(--border)' }}>
          {[
            { value: 'basic', label: 'Basic Scan', title: 'GitHub-API-only — no clone. Fast: ~1-5 seconds.' },
            { value: 'deep',  label: 'Deep Scan',  title: 'Clones the repo once, caches it, and runs the full architecture/quality/security/dependency pipeline.' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={loading}
              title={opt.title}
              onClick={() => setScanMode(opt.value)}
              style={{
                padding: '5px 12px', borderRadius: 'calc(var(--radius) - 2px)', fontSize: 12,
                fontWeight: 600, border: 'none', cursor: loading ? 'default' : 'pointer',
                background: scanMode === opt.value ? 'linear-gradient(135deg,#4f7ef8,#2563eb)' : 'transparent',
                color: scanMode === opt.value ? '#fff' : 'var(--text-muted)',
                transition: 'var(--transition)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {scanMode === 'deep' && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12.5, color: 'var(--text-muted)', cursor: loading ? 'default' : 'pointer',
            userSelect: 'none', width: 'fit-content',
          }}>
            <input
              type="checkbox"
              checked={deepScan}
              disabled={loading}
              onChange={e => setDeepScan(e.target.checked)}
              style={{ width: 14, height: 14, accentColor: 'var(--accent, #4f7ef8)', cursor: 'inherit' }}
            />
            Exhaustive — check every file, no sampling
            <span title="On large repos, security/quality analysis samples a representative subset of files by default to stay fast. Turning this on reads every matching file instead — exhaustive, but can take several minutes on very large repos."
                  style={{ color: 'var(--text-faint, #9ca3af)', cursor: 'help' }}>ⓘ</span>
          </label>
        )}
      </div>
    </form>
  );
}
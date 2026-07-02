import React, { useState, useRef, useCallback } from 'react';
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

export default function RepositoryForm({ onAnalysisStarted, toast, findExistingByUrl, onAlreadyScanned }) {
  const [repoUrl, setRepoUrl]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [stage, setStage]       = useState('');   // current backend status label
  const [percent, setPercent]   = useState(0);     // progress_percent for the fill bar
  const pollRef   = useRef(null);
  const trackedId = useRef(null); // id of the row we're currently polling, once known

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // While the (blocking) POST /api/analyze/ request is in flight, the
  // analysis row already exists in the DB and is being updated stage by
  // stage. Poll the list endpoint to find that row and reflect its live
  // status + percent right inside the button instead of a static spinner.
  const startPolling = useCallback((submittedUrl, submittedAt) => {
    stopPolling();
    trackedId.current = null;
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get('analysis/');
        const rows = res.data.results || [];
        let row;
        if (trackedId.current != null) {
          row = rows.find(r => r.id === trackedId.current);
        } else {
          // Not found yet — match by url + recency until we lock onto an id.
          row = rows
            .filter(r => r.repo_url === submittedUrl && new Date(r.created_at) >= submittedAt)
            .sort((a, b) => b.id - a.id)[0];
          if (row) trackedId.current = row.id;
        }
        if (row) {
          setStage(row.status);
          setPercent(row.progress_percent ?? 0);
        }
      } catch {
        // transient — keep trying, the next tick will retry
      }
    }, 1000);
  }, [stopPolling]);

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

    setLoading(true);
    setStage('Queued');
    setPercent(0);
    const submittedAt = new Date();
    startPolling(trimmed, submittedAt);

    try {
      const res = await api.post('analyze/', { repo_url: trimmed });
      setRepoUrl('');
      toast?.success(`Analysis ${res.data.cached ? 'loaded from cache' : 'completed'} for ${res.data.data?.project_name || 'repository'}`);
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

  const buttonLabel = STAGE_LABELS[stage] || (loading ? 'Submitting…' : 'Analyze');

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
    </form>
  );
}
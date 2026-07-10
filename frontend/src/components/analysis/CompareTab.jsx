import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { GradeBadge } from '../ui/Badge';
import { ScanModeNotice } from '../ui/ScanModeNotice';
import { normalizeRepoUrl } from '../../utils/helpers';

// Cross-repo comparison only — pick any OTHER repository you've analyzed
// and see the two side by side. For diffing THIS repo against its own
// earlier scans instead, see UpdatesTab (the "Updates" tab).

function ScoreRow({ label, a, b }) {
  const winner = a != null && b != null ? (a === b ? null : a > b ? 'a' : 'b') : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', alignItems: 'center',
                  gap: 12, padding: '10px 14px', background: 'var(--bg-subtle)',
                  border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ textAlign: 'right', fontSize: 16, fontWeight: 800,
                    color: winner === 'a' ? 'var(--grade-a)' : 'var(--text-strong)' }}>
        {a != null ? Math.round(a) : '—'}
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ textAlign: 'left', fontSize: 16, fontWeight: 800,
                    color: winner === 'b' ? 'var(--grade-a)' : 'var(--text-strong)' }}>
        {b != null ? Math.round(b) : '—'}
      </div>
    </div>
  );
}

function findingKey(f) {
  return `${f.title}::${f.file || ''}`;
}

export default function CompareTab({ analysis, scanMode, onRunDeepScan, deepScanRunning, deepScanProgress }) {
  const [candidates, setCandidates] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [other, setOther] = useState(null);
  const [otherLoading, setOtherLoading] = useState(false);
  const [otherError, setOtherError] = useState(null);

  useEffect(() => {
    if (scanMode === 'basic') return; // nothing to fetch — see notice below
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    const normTarget = normalizeRepoUrl(analysis.repo_url);

    api.get('analysis/', { params: { page_size: 100 } })
      .then(res => {
        if (cancelled) return;
        const results = (res.data.results || []).filter(a =>
          a.id !== analysis.id
          && a.status === 'Completed'
          && normalizeRepoUrl(a.repo_url) !== normTarget // different repos only
        );
        setCandidates(results);
      })
      .catch(err => {
        if (cancelled) return;
        setListError(err?.response?.data?.error || 'Could not load your other repositories.');
      })
      .finally(() => { if (!cancelled) setListLoading(false); });

    return () => { cancelled = true; };
  }, [analysis.id, analysis.repo_url, scanMode]);

  useEffect(() => {
    if (!selectedId) { setOther(null); return; }
    let cancelled = false;
    setOtherLoading(true);
    setOtherError(null);

    api.get(`analysis/${selectedId}/`)
      .then(res => { if (!cancelled) setOther(res.data); })
      .catch(err => {
        if (cancelled) return;
        setOtherError(err?.response?.data?.error || 'Could not load that repository.');
      })
      .finally(() => { if (!cancelled) setOtherLoading(false); });

    return () => { cancelled = true; };
  }, [selectedId]);

  const curMeta = analysis.metadata || {};
  const otherMeta = other?.metadata || {};

  const { onlyInCurrent, onlyInOther, inBoth } = useMemo(() => {
    if (!other) return { onlyInCurrent: [], onlyInOther: [], inBoth: [] };
    const curFindings = curMeta.security?.findings || [];
    const otherFindings = otherMeta.security?.findings || [];
    const curKeys = new Set(curFindings.map(findingKey));
    const otherKeys = new Set(otherFindings.map(findingKey));
    return {
      onlyInCurrent: curFindings.filter(f => !otherKeys.has(findingKey(f))),
      onlyInOther: otherFindings.filter(f => !curKeys.has(findingKey(f))),
      inBoth: curFindings.filter(f => otherKeys.has(findingKey(f))),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other]);

  // A Basic Scan never collects security findings or quality metrics —
  // comparing two basic scans would just show "0 findings" on both sides,
  // which looks like "no issues" rather than "not checked". Same pattern
  // used by Security/Health/Architecture tabs.
  if (scanMode === 'basic') {
    return (
      <ScanModeNotice label="Comparison data" onRunDeepScan={onRunDeepScan}
                      running={deepScanRunning} progress={deepScanProgress} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Compare "{analysis.project_name || 'this repository'}" against…
        </div>

        {listLoading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading your other scans…</div>}
        {listError && <div role="alert" style={{ fontSize: 13, color: 'var(--grade-f)' }}>{listError}</div>}

        {!listLoading && !listError && candidates.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Analyze at least one more (Deep Scanned) repository to have something to compare against.
          </div>
        )}

        {!listLoading && !listError && candidates.length > 0 && (
          <select
            value={selectedId || ''}
            onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            style={{ width: '100%', maxWidth: 360, padding: '10px 12px', fontSize: 13,
                     background: 'var(--bg-input)', border: '1px solid var(--border)',
                     borderRadius: 8, color: 'var(--text-strong)' }}
          >
            <option value="">Choose a repository to compare against…</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>
                {c.project_name || c.repo_url} {c.metadata?.composite_score != null ? `— ${Math.round(c.metadata.composite_score)}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {otherLoading && (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>
          Loading comparison…
        </div>
      )}
      {otherError && (
        <div role="alert" style={{ textAlign: 'center', padding: 32, color: 'var(--grade-f)' }}>{otherError}</div>
      )}

      {!otherLoading && !otherError && !other && !listLoading && candidates.length > 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>⚖️</div>
          Pick a repository above to see how it stacks up.
        </div>
      )}

      {other && other.scan_mode === 'basic' && (
        <div style={{ fontSize: 12, color: 'var(--grade-c, #d97706)', background: 'rgba(217,119,6,0.08)',
                      border: '1px solid rgba(217,119,6,0.2)', borderRadius: 8, padding: '8px 12px' }}>
          "{other.project_name}" was only Basic Scanned — its security/quality figures below will be empty, not clean.
        </div>
      )}

      {other && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 1fr', alignItems: 'center', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {analysis.project_name}
              </div>
              {curMeta.composite_grade && (
                <div style={{ marginTop: 4 }}><GradeBadge grade={curMeta.composite_grade} /></div>
              )}
            </div>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-faint)', fontWeight: 700 }}>VS</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {other.project_name}
              </div>
              {otherMeta.composite_grade && (
                <div style={{ marginTop: 4 }}><GradeBadge grade={otherMeta.composite_grade} /></div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ScoreRow label="Composite" a={curMeta.composite_score} b={otherMeta.composite_score} />
            <ScoreRow label="Quality" a={curMeta.quality?.overall_score} b={otherMeta.quality?.overall_score} />
            <ScoreRow label="Security Risk" a={curMeta.security?.risk_score} b={otherMeta.security?.risk_score} />
            <ScoreRow label="Dependency Health" a={curMeta.dependencies?.health_score} b={otherMeta.dependencies?.health_score} />
            <ScoreRow label="Files Scanned" a={analysis.file_count} b={other.file_count} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Only in {analysis.project_name} ({onlyInCurrent.length})
              </div>
              {onlyInCurrent.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing unique here.</div>
              ) : onlyInCurrent.map((f, i) => (
                <div key={i} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--text-strong)' }}>{f.title}</strong>
                  {f.file && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{f.file}</div>}
                </div>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Only in {other.project_name} ({onlyInOther.length})
              </div>
              {onlyInOther.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Nothing unique here.</div>
              ) : onlyInOther.map((f, i) => (
                <div key={i} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <strong style={{ color: 'var(--text-strong)' }}>{f.title}</strong>
                  {f.file && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{f.file}</div>}
                </div>
              ))}
            </div>
          </div>

          {inBoth.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {inBoth.length} finding type{inBoth.length === 1 ? '' : 's'} showed up in both repositories.
            </div>
          )}
        </>
      )}
    </div>
  );
}
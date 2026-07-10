import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ScanModeNotice } from '../ui/ScanModeNotice';

// "What changed since my last scan of THIS repo" — separate from Compare
// (which is for putting two DIFFERENT repos side by side). Auto-selects
// the most recent previous scan of this same repo, since that's the only
// thing there is to pick from here.

function ScoreDelta({ label, current, previous }) {
  const delta = current != null && previous != null ? current - previous : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', background: 'var(--bg-subtle)',
                  border: '1px solid var(--border)', borderRadius: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>
          {previous != null ? Math.round(previous) : '—'}
        </span>
        <span style={{ color: 'var(--text-faint)' }}>→</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-strong)' }}>
          {current != null ? Math.round(current) : '—'}
        </span>
        {delta != null && delta !== 0 && (
          <span style={{ fontSize: 12, fontWeight: 700,
                         color: delta > 0 ? 'var(--grade-a)' : 'var(--grade-f)' }}>
            ({delta > 0 ? '+' : ''}{Math.round(delta)})
          </span>
        )}
      </div>
    </div>
  );
}

function findingKey(f) {
  return `${f.title}::${f.file || ''}`;
}

export default function UpdatesTab({ analysis, scanMode, onRunDeepScan, deepScanRunning, deepScanProgress }) {
  const [state, setState] = useState({ loading: true, error: null, previous: null });

  useEffect(() => {
    if (scanMode === 'basic') return; // nothing to fetch — see notice below
    let cancelled = false;
    setState({ loading: true, error: null, previous: null });

    api.get('analysis/trend/', { params: { repo_url: analysis.repo_url } })
      .then(async res => {
        if (cancelled) return;
        const points = (res.data.points || []).filter(p => p.id !== analysis.id);
        if (points.length === 0) {
          setState({ loading: false, error: null, previous: null });
          return;
        }
        // trend points are oldest-first; the last one before "now" is the
        // most recent previous scan of this same repo.
        const mostRecent = points[points.length - 1];
        const detail = await api.get(`analysis/${mostRecent.id}/`);
        if (cancelled) return;
        setState({ loading: false, error: null, previous: detail.data });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ loading: false, error: err?.response?.data?.error || 'Could not load update history.', previous: null });
      });

    return () => { cancelled = true; };
  }, [analysis.id, analysis.repo_url, scanMode]);

  if (scanMode === 'basic') {
    return (
      <ScanModeNotice label="Update history" onRunDeepScan={onRunDeepScan}
                      running={deepScanRunning} progress={deepScanProgress} />
    );
  }

  if (state.loading) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>Loading…</div>;
  }
  if (state.error) {
    return <div role="alert" style={{ textAlign: 'center', padding: 48, color: 'var(--grade-f)' }}>{state.error}</div>;
  }
  if (!state.previous) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
        This is the first scan on record for this repository — rescan it later to see what's changed.
      </div>
    );
  }

  const curMeta = analysis.metadata || {};
  const prevMeta = state.previous.metadata || {};
  const curFindings = curMeta.security?.findings || [];
  const prevFindings = prevMeta.security?.findings || [];
  const curKeys = new Set(curFindings.map(findingKey));
  const prevKeys = new Set(prevFindings.map(findingKey));
  const newFindings = curFindings.filter(f => !prevKeys.has(findingKey(f)));
  const resolvedFindings = prevFindings.filter(f => !curKeys.has(findingKey(f)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Since the scan on {new Date(state.previous.created_at).toLocaleString()}
          {state.previous.commit_sha && (
            <span style={{ fontFamily: 'var(--mono)', marginLeft: 8, color: 'var(--text-faint)' }}>
              ({state.previous.commit_sha.slice(0, 7)})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ScoreDelta label="Composite Score" current={curMeta.composite_score} previous={prevMeta.composite_score} />
          <ScoreDelta label="Quality Score" current={curMeta.quality?.overall_score} previous={prevMeta.quality?.overall_score} />
          <ScoreDelta label="Security Risk Score" current={curMeta.security?.risk_score} previous={prevMeta.security?.risk_score} />
          <ScoreDelta label="Dependency Health" current={curMeta.dependencies?.health_score} previous={prevMeta.dependencies?.health_score} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--grade-f)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            New Findings ({newFindings.length})
          </div>
          {newFindings.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No new security findings since last scan.</div>
          ) : newFindings.map((f, i) => (
            <div key={i} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--text-strong)' }}>{f.title}</strong>
              {f.file && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{f.file}</div>}
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--grade-a)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Resolved Findings ({resolvedFindings.length})
          </div>
          {resolvedFindings.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No findings were resolved since last scan.</div>
          ) : resolvedFindings.map((f, i) => (
            <div key={i} style={{ fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--text-strong)', textDecoration: 'line-through', opacity: 0.7 }}>{f.title}</strong>
              {f.file && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{f.file}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
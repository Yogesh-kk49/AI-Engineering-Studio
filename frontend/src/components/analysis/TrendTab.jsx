import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ScanModeNotice } from '../ui/ScanModeNotice';

// The backend's RepositoryTrendView (GET /api/analysis/trend/?repo_url=)
// already existed and already returns exactly this shape — it just had
// no frontend consumer yet. This tab is the missing UI for it.

const LINES = [
  { key: 'composite_score',      label: 'Composite', color: 'var(--accent)' },
  { key: 'quality_score',        label: 'Quality',    color: 'var(--accent-3)' },
  { key: 'security_risk_score',  label: 'Security',   color: 'var(--grade-f)' },
];

function Sparkline({ points, colorKey, width = 640, height = 180 }) {
  const values = points.map(p => p[colorKey]).filter(v => v != null);
  if (values.length < 2) return null;

  const max = Math.max(100, ...values);
  const min = Math.min(0, ...values);
  const range = Math.max(1, max - min);
  const stepX = width / (points.length - 1);

  const coordsFor = (key) => points
    .map((p, i) => {
      const v = p[key];
      if (v == null) return null;
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return { x, y };
    });

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
         style={{ display: 'block' }} role="img" aria-label="Score trend chart">
      {/* Gridlines at 0/25/50/75/100 for a rough visual scale */}
      {[0, 25, 50, 75, 100].map(v => {
        const y = height - ((v - min) / range) * height;
        return (
          <line key={v} x1={0} y1={y} x2={width} y2={y}
                stroke="var(--border)" strokeWidth={1} strokeDasharray="4 4" />
        );
      })}

      {LINES.map(line => {
        const coords = coordsFor(line.key).filter(Boolean);
        if (coords.length < 2) return null;
        const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
        return (
          <g key={line.key}>
            <path d={path} fill="none" stroke={line.color} strokeWidth={2.5}
                  strokeLinecap="round" strokeLinejoin="round" />
            {coords.map((c, i) => (
              <circle key={i} cx={c.x} cy={c.y} r={3.5} fill={line.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export default function TrendTab({ repoUrl, scanMode, onRunDeepScan, deepScanRunning, deepScanProgress }) {
  const [state, setState] = useState({ loading: true, error: null, points: [] });

  useEffect(() => {
    if (!repoUrl || scanMode === 'basic') return;
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    api.get('analysis/trend/', { params: { repo_url: repoUrl } })
      .then(res => {
        if (cancelled) return;
        setState({ loading: false, error: null, points: res.data.points || [] });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ loading: false, error: err?.response?.data?.error || 'Could not load trend data.', points: [] });
      });

    return () => { cancelled = true; };
  }, [repoUrl, scanMode]);

  if (scanMode === 'basic') {
    return (
      <ScanModeNotice label="Score trend" onRunDeepScan={onRunDeepScan}
                      running={deepScanRunning} progress={deepScanProgress} />
    );
  }

  if (state.loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
        Loading history…
      </div>
    );
  }

  if (state.error) {
    return <div role="alert" style={{ textAlign: 'center', padding: 48, color: 'var(--grade-f)' }}>{state.error}</div>;
  }

  if (state.points.length < 2) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>📈</div>
        Run a Deep Scan on this repository at least twice to see how its scores trend over time.
      </div>
    );
  }

  const latest = state.points[state.points.length - 1];
  const previous = state.points[state.points.length - 2];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {LINES.map(line => {
          const cur = latest[line.key];
          const prev = previous[line.key];
          const delta = cur != null && prev != null ? cur - prev : null;
          return (
            <div key={line.key} style={{ flex: '1 1 160px', background: 'var(--bg-subtle)',
                border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
                            color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: line.color }} />
                {line.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-strong)', marginTop: 4 }}>
                {cur != null ? Math.round(cur) : '—'}
                {delta != null && delta !== 0 && (
                  <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 8,
                                 color: delta > 0 ? 'var(--grade-a)' : 'var(--grade-f)' }}>
                    {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '16px 16px 8px' }}>
        <Sparkline points={state.points} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6,
                      fontSize: 11, color: 'var(--text-faint)' }}>
          <span>{new Date(state.points[0].created_at).toLocaleDateString()}</span>
          <span>{new Date(latest.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
        {LINES.map(line => (
          <div key={line.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 3, background: line.color, display: 'inline-block' }} />
            {line.label}
          </div>
        ))}
      </div>
    </div>
  );
}
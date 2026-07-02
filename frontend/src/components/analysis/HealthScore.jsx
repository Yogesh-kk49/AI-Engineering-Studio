import React from 'react';
import { ScoreRing } from '../ui/ScoreRing';
import { GradeBadge } from '../ui/Badge';
import { scoreColor } from '../../utils/helpers';

export default function HealthScore({ quality }) {
  const overall = quality?.overall_score;
  const grade   = quality?.overall_grade;
  const dims    = quality?.dimensions || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Big score header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
        <ScoreRing score={overall} size={100} />
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 42, fontWeight: 800, color: scoreColor(overall), lineHeight: 1 }}>
              {overall != null ? Math.round(overall) : '—'}
            </span>
            <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>/100</span>
            {grade && <GradeBadge grade={grade} size="lg" />}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {quality?.summary || 'Composite health score across all quality dimensions'}
          </p>
        </div>
      </div>

      {/* Dimension bars */}
      {dims.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {dims.map((d, i) => (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between',
                            marginBottom: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-strong)', fontWeight: 500 }}>
                  {d.name}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {d.grade && <GradeBadge grade={d.grade} />}
                  <span style={{ fontSize: 13, fontWeight: 700,
                                 color: d.score != null ? scoreColor(d.score) : 'var(--text-muted)',
                                 minWidth: 28, textAlign: 'right' }}>
                    {d.score != null ? Math.round(d.score) : '—'}
                  </span>
                </div>
              </div>
              {/* Bar */}
              <div style={{ background: '#f3f4f6', borderRadius: 99,
                            height: 6, overflow: 'hidden' }}>
                {d.score != null && (
                  <div style={{
                    height: '100%', width: `${d.score}%`,
                    background: scoreColor(d.score), borderRadius: 99,
                    boxShadow: `0 0 8px ${scoreColor(d.score)}60`,
                    transition: 'width 1s ease',
                  }} />
                )}
              </div>
              {/* Top findings */}
              {d.findings?.slice(0, 2).map((f, j) => (
                <span key={j} style={{ display: 'inline-block', marginTop: 4, marginRight: 4,
                  fontSize: 10, color: 'var(--text-muted)', background: '#f8f9fb',
                  padding: '1px 6px', borderRadius: 4 }}>{f}</span>
              ))}
            </div>
          ))}
        </div>
      )}

      {dims.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Detailed dimension breakdown not available for this analysis.
        </p>
      )}
    </div>
  );
}
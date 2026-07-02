import React from 'react';
import { scoreColor } from '../../utils/helpers';

export function ScoreRing({ score, size = 80, label, strokeWidth = 7 }) {
  const r      = (size - strokeWidth * 2) / 2;
  const circ   = 2 * Math.PI * r;
  const pct    = score != null ? Math.min(100, Math.max(0, score)) : 0;
  const offset = circ - (pct / 100) * circ;
  const color  = scoreColor(pct);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Track ring - light gray for white background */}
          <circle cx={size/2} cy={size/2} r={r}
            fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
          <circle
            cx={size/2} cy={size/2} r={r}
            fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)',
            }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: size > 70 ? 20 : 15, fontWeight: 800, color, lineHeight: 1 }}>
            {score != null ? Math.round(score) : '—'}
          </span>
        </div>
      </div>
      {label && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center',
                       textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
      )}
    </div>
  );
}
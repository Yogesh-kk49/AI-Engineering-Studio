import React from 'react';

/**
 * Circular progress ring with the percentage rendered in the center —
 * the same visual language as a typical upload/download progress ring
 * (thick colored arc over a light track, bold number in the middle).
 *
 * Pass `percent={null}` for an indeterminate state (spinning ring, no label).
 */
export function ProgressRing({
  percent = null,
  size = 40,
  strokeWidth = 4,
  color = 'var(--accent)',
  trackColor = 'rgba(79,126,248,0.15)',
  fontSize = null,
}) {
  const r    = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const indeterminate = percent == null;
  const pct    = indeterminate ? 0 : Math.min(100, Math.max(0, percent));
  const offset = circ - (pct / 100) * circ;
  const labelSize = fontSize || Math.max(9, Math.round(size * 0.3));

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size} height={size}
        style={{
          transform: 'rotate(-90deg)',
          animation: indeterminate ? 'spin 1s linear infinite' : 'none',
        }}
      >
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={indeterminate ? `${circ * 0.28} ${circ}` : circ}
          strokeDashoffset={indeterminate ? 0 : offset}
          strokeLinecap="round"
          style={{ transition: indeterminate ? 'none' : 'stroke-dashoffset 0.2s linear' }}
        />
      </svg>
      {!indeterminate && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: labelSize, fontWeight: 800, color, lineHeight: 1,
                         fontVariantNumeric: 'tabular-nums' }}>
            {Math.round(pct)}%
          </span>
        </div>
      )}
    </div>
  );
}
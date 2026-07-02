import React from 'react';
import { scoreColor } from '../../utils/helpers';

export function ProgressBar({ value, max = 100, color, height = 5 }) {
  const pct      = Math.min(100, Math.max(0, (value / max) * 100));
  const barColor = color || scoreColor(pct);
  return (
    <div style={{ background: '#e5e7eb', borderRadius: 99, height, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: barColor, borderRadius: 99,
        transition: 'width 1s cubic-bezier(0.4,0,0.2,1)',
      }} />
    </div>
  );
}

export function ScoreBar({ label, score }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 12, color: 'var(--text)', minWidth: 120 }}>{label}</span>
      <div style={{ flex: 1 }}><ProgressBar value={score} /></div>
      <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(score),
                     minWidth: 36, textAlign: 'right' }}>
        {score != null ? Math.round(score) : '—'}
      </span>
    </div>
  );
}
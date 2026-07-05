import React from 'react';

const ICONS  = { success: '✓', error: '✗', info: 'ℹ' };
const COLORS = {
  success: { border: 'var(--grade-a)', icon: 'var(--grade-a)' },
  error:   { border: 'var(--grade-f)', icon: 'var(--grade-f)' },
  info:    { border: 'var(--accent)',  icon: 'var(--accent)'  },
};

export function ToastContainer({ toasts, onRemove }) {
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
                  display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => onRemove(t.id)} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--bg-card)',
          border: `1px solid ${COLORS[t.type]?.border || 'var(--border)'}`,
          borderRadius: 'var(--radius)', padding: '12px 16px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)', cursor: 'pointer',
          animation: 'toastIn 0.3s ease', minWidth: 280, maxWidth: 400,
        }}>
          <span style={{
            width: 22, height: 22, borderRadius: '50%',
            background: `${COLORS[t.type]?.icon}18`,
            color: COLORS[t.type]?.icon,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
            {ICONS[t.type]}
          </span>
          <span style={{ color: 'var(--text-strong)', fontSize: 13, lineHeight: 1.4 }}>
            {t.message}
          </span>
        </div>
      ))}
    </div>
  );
}
import React, { useState } from 'react';

// The badge URL is public (see backend analyzer/badge_view.py) so it can
// be embedded directly in an external README — it deliberately does NOT
// go through the authenticated `api` axios instance.
function badgeUrl(analysisId) {
  const base = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/').replace(/\/$/, '');
  return `${base}/analysis/${analysisId}/badge.svg`;
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <code style={{ flex: 1, fontSize: 12, fontFamily: 'var(--mono)', background: 'var(--bg-subtle)',
                       border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px',
                       overflowX: 'auto', whiteSpace: 'nowrap', color: 'var(--text)' }}>
          {value}
        </code>
        <button
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ fontSize: 12, fontWeight: 600, padding: '0 14px', borderRadius: 6,
                   border: '1px solid var(--border)', background: copied ? 'var(--grade-a-bg)' : 'var(--bg-card)',
                   color: copied ? 'var(--grade-a)' : 'var(--text)', cursor: 'pointer', flexShrink: 0 }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function ShareBadge({ analysisId, projectName, onClose }) {
  const url = badgeUrl(analysisId);
  const markdown = `[![Code Health](${url})](${url})`;
  const html = `<img src="${url}" alt="Code Health badge for ${projectName || 'this repository'}" />`;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,23,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000, padding: 24 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share badge"
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 480,
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)' }}>Share this scorecard</span>
          <button onClick={onClose} aria-label="Close"
            style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent',
                     border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            This badge is public and doesn't require login to view anyone
            who has the link (e.g. in your repo's README) sees the current
            health grade and score, nothing else.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', padding: 16,
                        background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10 }}>
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img src={url} alt={`Code health badge for ${projectName || 'this repository'}`} style={{ height: 20 }} />
          </div>

          <CopyRow label="Markdown (README)" value={markdown} />
          <CopyRow label="HTML" value={html} />
          <CopyRow label="Direct link" value={url} />
        </div>
      </div>
    </div>
  );
}
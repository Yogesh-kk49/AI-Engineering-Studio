import React from 'react';
import { ProgressRing } from './ProgressRing';

/**
 * Shown instead of a tab's (misleadingly empty/zeroed) content when the
 * analysis was run as a Basic Scan, which never collects this data.
 * `label` describes what's missing, e.g. "Security findings".
 */
export function ScanModeNotice({ label, onRunDeepScan, running, progress }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, margin: '0 auto 16px',
                    background: 'rgba(79,126,248,0.10)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="var(--accent)" strokeWidth="2">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      </div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
        {label} isn't available for a Basic Scan
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 380,
                    margin: '0 auto 20px', lineHeight: 1.5 }}>
        Basic Scan only reads repository metadata from the GitHub API. Try Deep Scan
        to clone the repository and view the full details.
      </div>
      {onRunDeepScan && (
        <button
          onClick={onRunDeepScan}
          disabled={running}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '9px 18px', fontSize: 13, fontWeight: 700,
            borderRadius: 8, border: 'none',
            background: running ? 'var(--bg-card-hover)' : 'var(--accent)',
            color: running ? 'var(--text-muted)' : '#fff',
            cursor: running ? 'wait' : 'pointer', transition: 'var(--transition)',
          }}
        >
          {running ? (
            <>
              <ProgressRing percent={progress} size={16} strokeWidth={2.5} color="var(--accent)" />
              Running Deep Scan…
            </>
          ) : (
            'Try Deep Scan'
          )}
        </button>
      )}
    </div>
  );
}
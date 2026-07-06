import React from 'react';
import { GradeBadge } from '../ui/Badge';
import { ScoreRing } from '../ui/ScoreRing';
import { ScanModeNotice } from '../ui/ScanModeNotice';

export default function DependenciesTab({ dependencies, scanMode, onRunDeepScan, deepScanRunning, deepScanProgress }) {
  // A Basic Scan only does a lightweight dependency read (surfaced
  // separately as `basic_dependencies`) — this richer health-score/grade
  // breakdown only exists after a Deep Scan. The default result object
  // otherwise renders here as a false "0 dependencies, grade F".
  if (scanMode === 'basic') {
    return (
      <ScanModeNotice label="Dependency health breakdown" onRunDeepScan={onRunDeepScan}
                      running={deepScanRunning} progress={deepScanProgress} />
    );
  }

  if (!dependencies) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
      Dependency data not available
    </div>
  );

  const { health_score, grade, total_dependencies, pinned_count,
          unpinned_count, flagged_count, lock_files, recommendations } = dependencies;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
        <ScoreRing score={health_score} size={90} />
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            Dependency Health
          </div>
          {grade && <GradeBadge grade={grade} size="lg" />}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 10 }}>
        {[
          { label: 'Total',    value: total_dependencies, color: null },
          { label: 'Pinned',   value: pinned_count,       color: 'var(--grade-a)' },
          { label: 'Unpinned', value: unpinned_count,     color: 'var(--grade-c)' },
          { label: 'Flagged',  value: flagged_count,      color: flagged_count > 0 ? 'var(--grade-f)' : 'var(--grade-a)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ textAlign: 'center', padding: '12px 16px',
            background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: color || 'var(--text-strong)' }}>
              {value ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
                          textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
          </div>
        ))}
      </div>

      {lock_files?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Lock Files Detected
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {lock_files.map(f => (
              <span key={f} style={{ fontSize: 12, fontFamily: 'var(--mono)',
                background: 'rgba(16,185,129,0.1)', color: 'var(--grade-a)',
                padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(16,185,129,0.2)' }}>
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {recommendations?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Recommendations
          </div>
          {recommendations.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 14px', marginBottom: 6,
              background: 'rgba(6,182,212,0.04)', border: '1px solid rgba(6,182,212,0.12)',
              borderRadius: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--accent-2)', fontWeight: 700 }}>→</span>
              <span style={{ color: 'var(--text)' }}>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
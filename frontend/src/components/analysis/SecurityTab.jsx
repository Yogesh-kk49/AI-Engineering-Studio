import React, { useState } from 'react';
import { GradeBadge } from '../ui/Badge';
import { ScoreRing } from '../ui/ScoreRing';
import { dash } from '../../utils/helpers';

const SEV_COLORS = {
  CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#f59e0b', LOW: '#3b82f6', INFO: '#6b7280',
};

function Finding({ f }) {
  const [expanded, setExpanded] = useState(false);
  const color = SEV_COLORS[f.severity] || '#6b7280';
  const locations = f.locations || [];
  const grouped = f.occurrences > 1;
  // First location doubles as the always-visible example; the rest are
  // tucked behind "show more" so a widespread rule (e.g. exec() matched
  // on 200 lines) doesn't flood the report with near-duplicate rows.
  const primary = locations[0] || { file: f.file, line: f.line, snippet: f.snippet };
  const rest = locations.slice(1);
  const hiddenCount = Math.max(f.occurrences - locations.length, 0);

  return (
    <div style={{ background: 'var(--bg-subtle)',
                  border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`,
                  borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color,
                       background: `${color}18`, padding: '1px 7px', borderRadius: 4 }}>
          {f.severity}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
          {f.title}
        </span>
        {grouped && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                         background: '#eceff3', padding: '1px 8px', borderRadius: 20 }}>
            {f.occurrences} occurrences
          </span>
        )}
      </div>

      {primary.file && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6,
                      fontFamily: 'var(--mono)' }}>
          {primary.file}{primary.line ? `:${primary.line}` : ''}
        </div>
      )}

      {f.description && (
        <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6, lineHeight: 1.5 }}>
          {f.description}
        </div>
      )}

      {(rest.length > 0 || hiddenCount > 0) && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                     background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {expanded ? 'Hide locations' : `Show ${rest.length + (hiddenCount > 0 ? 1 : 0)} more location${rest.length + hiddenCount === 1 ? '' : 's'}`}
          </button>

          {expanded && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {rest.map((loc, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)',
                                      fontFamily: 'var(--mono)' }}>
                  {loc.file}{loc.line ? `:${loc.line}` : ''}
                </div>
              ))}
              {hiddenCount > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  + {hiddenCount} more, not shown
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SecurityTab({ security }) {
  if (!security) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
      Security data not available
    </div>
  );

  const findings = security.findings || [];
  const summary  = security.summary  || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap' }}>
        <ScoreRing score={security.risk_score} size={90} />
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            Security Risk Score
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {security.risk_grade && <GradeBadge grade={security.risk_grade} size="lg" />}
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {security.scanned_files} files scanned
            </span>
          </div>
        </div>
        {/* Severity summary pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {Object.entries(summary).map(([sev, count]) => count > 0 && (
            <div key={sev} style={{ textAlign: 'center',
              background: `${SEV_COLORS[sev] || '#6b7280'}15`,
              border: `1px solid ${SEV_COLORS[sev] || '#6b7280'}30`,
              borderRadius: 10, padding: '8px 14px' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: SEV_COLORS[sev] }}>{count}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)',
                            textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sev}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Findings list */}
      {findings.length > 0 ? (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Findings ({findings.length} rule{findings.length === 1 ? '' : 's'})
          </div>
          {findings.map((f, i) => <Finding key={i} f={f} />)}
        </div>
      ) : (
        <div style={{ padding: 32, textAlign: 'center',
                      background: 'rgba(16,185,129,0.05)',
                      border: '1px solid rgba(16,185,129,0.15)', borderRadius: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>
          <div style={{ color: 'var(--grade-a)', fontWeight: 600 }}>No security issues found</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            This repository passed all security checks
          </div>
        </div>
      )}

      {/* Recommendations */}
      {security.recommendations?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Recommendations
          </div>
          {security.recommendations.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0',
                                  borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--accent)', flexShrink: 0 }}>→</span>
              <span style={{ color: 'var(--text)' }}>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
import React from 'react';
import { gradeColor, gradeLabel } from '../../utils/helpers';

export function GradeBadge({ grade, size = 'sm' }) {
  const { bg, color } = gradeColor(grade);
  const label = gradeLabel(grade);
  return (
    <span title={label ? `${grade} — ${label}` : undefined} style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 5,
      background: bg, color,
      padding: size === 'lg' ? '6px 14px' : '2px 9px',
      borderRadius: 6,
      fontSize: size === 'lg' ? 15 : 12,
      fontWeight: 700, letterSpacing: '0.03em',
    }}>
      <span>{grade}</span>
      {label && (
        <span style={{ fontWeight: 600, opacity: 0.85,
                       fontSize: size === 'lg' ? 12 : 10.5 }}>
          {label}
        </span>
      )}
    </span>
  );
}

// Backend status pipeline: Queued -> Cloning -> Scanning -> AI Analysis
// -> Generating Report -> Completed / Failed. Everything except the two
// terminal statuses should render as the pulsing "in progress" badge,
// labeled with whatever stage it's actually in.
const IN_PROGRESS_STATUSES = ['Queued', 'Cloning', 'Scanning', 'AI Analysis', 'Generating Report'];

export function StatusBadge({ status }) {
  let cfg;
  if (status === 'Completed') {
    cfg = { bg: 'var(--status-done-bg)', color: 'var(--status-done)', label: 'Complete' };
  } else if (status === 'Failed') {
    cfg = { bg: 'var(--status-fail-bg)', color: 'var(--status-fail)', label: 'Failed' };
  } else if (IN_PROGRESS_STATUSES.includes(status)) {
    cfg = { bg: 'var(--status-pending-bg)', color: 'var(--status-pending)', label: status };
  } else {
    cfg = { bg: 'var(--bg-card-hover)', color: 'var(--text-muted)', label: status };
  }

  const isInProgress = IN_PROGRESS_STATUSES.includes(status);

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: cfg.bg, color: cfg.color,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 12, fontWeight: 600,
    }}>
      {isInProgress && (
        <span style={{ width: 6, height: 6, borderRadius: '50%',
                       background: cfg.color, animation: 'pulse 1.5s infinite' }} />
      )}
      {cfg.label}
    </span>
  );
}

export function Tag({ children, color }) {
  return (
    <span style={{
      display: 'inline-block',
      background: color ? `${color}18` : 'var(--bg-card-hover)',
      color: color || 'var(--text)',
      border: '1px solid',
      borderColor: color ? `${color}30` : 'var(--border)',
      padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 500,
    }}>
      {children}
    </span>
  );
}
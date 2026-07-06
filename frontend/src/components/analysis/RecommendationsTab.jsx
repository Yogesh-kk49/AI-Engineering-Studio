import React from 'react';
import { ScanModeNotice } from '../ui/ScanModeNotice';

const PRIORITY = {
  HIGH:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   label: 'High'   },
  MEDIUM: { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  label: 'Medium' },
  LOW:    { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  label: 'Low'    },
};

function RecCard({ rec, index }) {
  const p   = rec.priority || 'MEDIUM';
  const cfg = PRIORITY[p] || PRIORITY.MEDIUM;
  return (
    <div style={{ display: 'flex', gap: 14, padding: 16,
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: cfg.bg, border: `1px solid ${cfg.color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: cfg.color, fontWeight: 800, fontSize: 13 }}>
        {index + 1}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'flex-start', marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>
            {rec.title || rec}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color,
            background: cfg.bg, padding: '2px 8px', borderRadius: 4,
            flexShrink: 0, marginLeft: 8 }}>{cfg.label}</span>
        </div>
        {rec.description && (
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>
            {rec.description}
          </p>
        )}
        {rec.category && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>
            {rec.category}
          </span>
        )}
      </div>
    </div>
  );
}

export default function RecommendationsTab({ predictions, quality, security, architecture,
                                              scanMode, onRunDeepScan, deepScanRunning, deepScanProgress }) {
  // Every source this tab pulls from (predictions, architecture, security,
  // quality) is only populated by a Deep Scan. On a Basic Scan they're all
  // empty defaults, which would otherwise render here as a false
  // "no major recommendations, this repo is in great shape".
  if (scanMode === 'basic') {
    return (
      <ScanModeNotice label="Recommendations" onRunDeepScan={onRunDeepScan}
                      running={deepScanRunning} progress={deepScanProgress} />
    );
  }

  const recs = [];
  (predictions?.top_opportunities || []).forEach(r =>
    recs.push(typeof r === 'string' ? { title: r, priority: 'HIGH' } : r));
  (predictions?.top_risks || []).forEach(r =>
    recs.push(typeof r === 'string' ? { title: r, priority: 'MEDIUM' } : r));
  (architecture?.recommendations || []).forEach(r =>
    recs.push(typeof r === 'string' ? { title: r, priority: 'MEDIUM', category: 'Architecture' } : r));
  (security?.recommendations || []).forEach(r =>
    recs.push(typeof r === 'string' ? { title: r, priority: 'HIGH', category: 'Security' } : r));
  (quality?.dimensions || []).forEach(d =>
    (d.suggestions || []).forEach(s =>
      recs.push({ title: s, priority: 'LOW', category: d.name })));

  if (!recs.length) return (
    <div style={{ textAlign: 'center', padding: 64 }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 600, fontSize: 16 }}>
        No major recommendations
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
        This repository is in great shape!
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18 }}>
        {recs.length} recommendations across all categories
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recs.map((r, i) => <RecCard key={i} rec={r} index={i} />)}
      </div>

      {predictions?.trajectory_summary && (
        <div style={{ marginTop: 24, padding: 20,
          background: 'rgba(139,92,246,0.06)',
          border: '1px solid rgba(139,92,246,0.2)', borderRadius: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Trajectory Forecast
          </div>
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
            {predictions.trajectory_summary}
          </p>
        </div>
      )}
    </div>
  );
}
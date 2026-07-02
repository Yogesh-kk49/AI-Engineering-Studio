import React, { useState, useRef } from 'react';
import { GradeBadge, StatusBadge, Tag } from './ui/Badge';
import { ScoreRing } from './ui/ScoreRing';
import { formatNumber, timeAgo } from '../utils/helpers';
import OverviewTab       from './analysis/OverviewTab';
import HealthScore       from './analysis/HealthScore';
import SecurityTab       from './analysis/SecurityTab';
import ArchitectureTab   from './analysis/ArchitectureTab';
import ArchitectureGraphTab from './analysis/ArchitectureGraphTab';
import FileFlowChart from './analysis/FileFlowChart';
import DependenciesTab   from './analysis/DependenciesTab';
import RecommendationsTab from './analysis/RecommendationsTab';
import { isAnalysisInProgress } from '../hooks/useAnalyses';
import api from '../services/api';

const TABS = [
  { id: 'overview',         label: 'Overview'        },
  { id: 'health',           label: 'Health Score'    },
  { id: 'architecture',     label: 'Architecture'    },
  { id: 'structure',        label: 'Project Structure' },
  { id: 'flowchart',        label: 'File Flow Chart' },
  { id: 'security',         label: 'Security'        },
  { id: 'dependencies',     label: 'Dependencies'    },
  { id: 'recommendations',  label: 'Recommendations' },
];

export default function AnalysisCard({ analysis, onDelete, onRescanned, toast }) {
  const [open, setOpen]           = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(null);   // 'markdown' | 'pdf' | null
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const rescanLockRef = useRef(false); // synchronous guard — state updates aren't fast enough to stop a double-click
  const rescanAbortRef = useRef(null); // lets the Pause button cancel the in-flight rescan request
  const m         = analysis.metadata || {};
  const isPending = isAnalysisInProgress(analysis);
  const isFailed  = analysis.status === 'Failed';

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm(`Delete analysis for "${analysis.project_name}"?`)) {
      onDelete?.(analysis.id);
    }
  };

  const handleDownload = async (e) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await api.get(`analysis/${analysis.id}/download/`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${analysis.project_name || 'repository'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      window.alert('Could not download this repository — the cloned files may no longer be on the server.');
    } finally {
      setDownloading(false);
    }
  };

  const handleRescan = async (e) => {
    e.stopPropagation();
    if (rescanLockRef.current) return;
    rescanLockRef.current = true;
    setRescanning(true);

    const controller = new AbortController();
    rescanAbortRef.current = controller;

    try {
      // Don't force a reclone — let the backend check the latest commit
      // SHA first (one cheap API call). If nothing's changed since the
      // last scan, it returns the existing result instantly instead of
      // re-cloning and re-analyzing the whole repo for no reason. A real
      // re-clone + full pipeline only runs when there's an actual new
      // commit to look at.
      const res = await api.post('analyze/', {
        repo_url: analysis.repo_url,
        branch: analysis.branch || '',
      }, { signal: controller.signal });
      await onRescanned?.(res.data.data, analysis.id, !!res.data.cached);
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        // User-initiated pause — the backend already created the analysis
        // row and queued the job before we aborted, so it keeps running
        // server-side. It'll simply appear in the history list on the
        // next background poll instead of us waiting for it here.
        toast?.info?.('Rescan paused — it\'ll keep going in the background and show up in your history when ready.');
      } else {
        window.alert(err?.response?.data?.error || 'Could not rescan this repository.');
      }
    } finally {
      rescanAbortRef.current = null;
      rescanLockRef.current = false;
      setRescanning(false);
    }
  };

  const handlePauseRescan = (e) => {
    e.stopPropagation();
    rescanAbortRef.current?.abort();
  };

  const handleExport = async (e, format) => {
    e.stopPropagation();
    setExportMenuOpen(false);
    if (exporting) return;
    setExporting(format);
    try {
      const ext = format === 'pdf' ? 'pdf' : 'md';
      const res = await api.get(`analysis/${analysis.id}/export/${format === 'pdf' ? 'pdf' : 'markdown'}/`,
                                 { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${analysis.project_name || 'repository'}-report.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      window.alert(`Could not generate the ${format === 'pdf' ? 'PDF' : 'Markdown'} report.`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${open ? 'rgba(79,126,248,0.35)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      transition: 'var(--transition)',
      boxShadow: open ? '0 2px 12px rgba(79,126,248,0.08), var(--shadow-card)' : 'var(--shadow-card)',
    }}>
      {/* ── Card header ── */}
      <div
        onClick={() => !isPending && setOpen(o => !o)}
        style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16,
                 cursor: isPending ? 'default' : 'pointer' }}
      >
        {/* Icon */}
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: isPending ? 'rgba(245,158,11,0.10)' : 'rgba(79,126,248,0.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {isPending
            ? <span style={{ width: 16, height: 16,
                border: '2px solid rgba(245,158,11,0.25)', borderTopColor: 'var(--status-pending)',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'block' }} />
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="var(--accent)" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
          }
        </div>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <a href={analysis.repo_url} target="_blank" rel="noreferrer"
               onClick={e => e.stopPropagation()}
               style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-heading)' }}>
              {analysis.project_name}
            </a>
            <StatusBadge status={analysis.status} />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
            {m.primary_language && <Tag>{m.primary_language}</Tag>}
            {m.stars != null && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                ⭐ {formatNumber(m.stars)}
              </span>
            )}
            {analysis.file_count > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                📄 {analysis.file_count} files
              </span>
            )}
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {timeAgo(analysis.created_at)}
            </span>
          </div>
        </div>

        {/* Score rings */}
        {!isPending && !isFailed && (
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            <ScoreRing score={m.composite_score} size={56} label="Overall" />
            {m.quality?.overall_score  != null && <ScoreRing score={m.quality.overall_score}  size={48} label="Quality"  />}
            {m.security?.risk_score    != null && <ScoreRing score={m.security.risk_score}    size={48} label="Security" />}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          {!isPending && !isFailed && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setExportMenuOpen(o => !o)}
                disabled={!!exporting}
                title="Export report"
                style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: exporting ? 'wait' : 'pointer', transition: 'var(--transition)' }}
                onMouseEnter={e => { if (!exporting) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; } }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)';  e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                {exporting ? (
                  <span style={{ width: 13, height: 13, border: '2px solid rgba(79,126,248,0.25)',
                                 borderTopColor: 'var(--accent)', borderRadius: '50%',
                                 animation: 'spin 0.7s linear infinite', display: 'block' }} />
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="9" y1="13" x2="15" y2="13"/>
                    <line x1="9" y1="17" x2="13" y2="17"/>
                  </svg>
                )}
              </button>

              {exportMenuOpen && (
                <>
                  <div onClick={() => setExportMenuOpen(false)}
                       style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                  <div style={{ position: 'absolute', top: 36, right: 0, zIndex: 11,
                                background: 'var(--bg-card)', border: '1px solid var(--border)',
                                borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                                minWidth: 160, overflow: 'hidden' }}>
                    <button
                      onClick={e => handleExport(e, 'markdown')}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 12px',
                               fontSize: 12.5, background: 'none', border: 'none',
                               color: 'var(--text)', cursor: 'pointer', display: 'block' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    >
                      📝 Export as Markdown
                    </button>
                    <button
                      onClick={e => handleExport(e, 'pdf')}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 12px',
                               fontSize: 12.5, background: 'none', border: 'none',
                               color: 'var(--text)', cursor: 'pointer', display: 'block',
                               borderTop: '1px solid var(--border)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                    >
                      📄 Export as PDF
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {!isPending && (
            <button
              onClick={rescanning ? handlePauseRescan : handleRescan}
              title={rescanning ? 'Pause rescan' : 'Check for updates (instant if nothing changed)'}
              style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent',
                border: `1px solid ${rescanning ? 'var(--accent)' : 'var(--border)'}`,
                color: rescanning ? 'var(--accent)' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'var(--transition)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = rescanning ? 'var(--accent)' : 'var(--border)'; e.currentTarget.style.color = rescanning ? 'var(--accent)' : 'var(--text-muted)'; }}
            >
              {rescanning ? (
                // Pause icon (two bars) — click to cancel the wait for this rescan
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/>
                  <polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                </svg>
              )}
            </button>
          )}

          {!isPending && !isFailed && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              title="Download repository as ZIP"
              style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent',
                border: '1px solid var(--border)', color: 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: downloading ? 'wait' : 'pointer', transition: 'var(--transition)' }}
              onMouseEnter={e => { if (!downloading) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)';  e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              {downloading ? (
                <span style={{ width: 13, height: 13, border: '2px solid rgba(79,126,248,0.25)',
                               borderTopColor: 'var(--accent)', borderRadius: '50%',
                               animation: 'spin 0.7s linear infinite', display: 'block' }} />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              )}
            </button>
          )}

          <button
            onClick={handleDelete}
            title="Delete"
            style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent',
              border: '1px solid var(--border)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'var(--transition)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--grade-f)'; e.currentTarget.style.color = 'var(--grade-f)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)';  e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
          </button>

          {!isPending && (
            <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: 'var(--text-muted)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2"
                   style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', animation: 'slideDown 0.2s ease' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)',
                        padding: '0 20px', overflowX: 'auto', background: '#fafbfc' }}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                padding: '12px 16px', fontSize: 13, fontWeight: 500,
                background: 'none', border: 'none',
                borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
                color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer', transition: 'var(--transition)',
                whiteSpace: 'nowrap', marginBottom: -1,
              }}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ padding: 24, animation: 'fadeIn 0.2s ease', background: 'var(--bg-card)' }}>
            {activeTab === 'overview'        && <OverviewTab analysis={analysis} />}
            {activeTab === 'health'          && <HealthScore quality={m.quality} />}
            {activeTab === 'architecture'    && <ArchitectureTab architecture={m.architecture} />}
            {activeTab === 'structure'       && <ArchitectureGraphTab fileTree={m.file_tree} analysisId={analysis.id} />}
            {activeTab === 'flowchart'       && <FileFlowChart fileTree={m.file_tree} analysisId={analysis.id} />}
            {activeTab === 'security'        && <SecurityTab security={m.security} />}
            {activeTab === 'dependencies'    && <DependenciesTab dependencies={m.dependencies} />}
            {activeTab === 'recommendations' && (
              <RecommendationsTab predictions={m.predictions} quality={m.quality}
                                  security={m.security} architecture={m.architecture} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
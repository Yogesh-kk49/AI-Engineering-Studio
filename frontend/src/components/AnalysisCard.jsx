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
import AIChatTab from './analysis/AIChatTab';
import { isAnalysisInProgress } from '../hooks/useAnalyses';
import api from '../services/api';

// AI Chat now sits right after Overview, per request.
const TABS = [
  { id: 'overview',         label: 'Overview'        },
  { id: 'chat',             label: '✦ AI Chat'       },
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
  const [downloadSlow, setDownloadSlow] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null); // 0-100, or null while size is still unknown
  const downloadSlowTimerRef = useRef(null);
  const [exporting, setExporting] = useState(null);   // 'markdown' | 'pdf' | null
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportMenuPos, setExportMenuPos] = useState(null);
  const exportBtnRef = useRef(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  // Rescanning has no bytes to measure (it's a single JSON response, not a
  // file stream), so there's no real percentage to report the way the
  // download has. Instead we simulate a Chrome/YouTube-upload-style ring:
  // climb quickly, ease off near the top, and only snap to 100% once the
  // real response actually lands — so it never looks frozen, and it never
  // lies by claiming to be done before the server says so.
  const [rescanProgress, setRescanProgress] = useState(0);
  const rescanProgressTimerRef = useRef(null);
  const rescanLockRef = useRef(false); // synchronous guard — state updates aren't fast enough to stop a double-click
  const rescanAbortRef = useRef(null); // lets the Pause button cancel the in-flight rescan request
  const m         = analysis.metadata || {};
  const isPending = isAnalysisInProgress(analysis);
  const isFailed  = analysis.status === 'Failed';

  const handleDelete = (e) => {
    e.stopPropagation();
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    setDeleteConfirmOpen(false);
    onDelete?.(analysis.id);
  };

  const toggleExportMenu = (e) => {
    e.stopPropagation();
    if (exportMenuOpen) {
      setExportMenuOpen(false);
      return;
    }
    const rect = exportBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setExportMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setExportMenuOpen(true);
  };

  const handleDownload = async (e) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    setDownloadProgress(null);
    // The backend has to clone/refresh the repo and zip it before the
    // response starts streaming, so large repos can take a while with no
    // visible progress. After 8s, swap the tooltip/spinner to say so
    // explicitly rather than leaving it looking frozen.
    downloadSlowTimerRef.current = setTimeout(() => setDownloadSlow(true), 8000);
    try {
      const res = await api.get(`analysis/${analysis.id}/download/`, {
        responseType: 'blob',
        onDownloadProgress: (progressEvent) => {
          // total is only known when the server sends a Content-Length
          // header — GitHub's zipball response usually does, but if it's
          // ever missing (chunked/compressed transfer), fall back to
          // showing an indeterminate spinner instead of a stuck 0%.
          if (progressEvent.total) {
            setDownloadSlow(false); // real progress beats the "still fetching" message
            setDownloadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
          }
        },
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${analysis.project_name || 'repository'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      if (err?.code === 'ECONNABORTED') {
        window.alert('The download timed out — this repository may be too large to fetch fresh each time.');
      } else {
        window.alert('Could not download this repository — the cloned files may no longer be on the server.');
      }
    } finally {
      clearTimeout(downloadSlowTimerRef.current);
      setDownloadSlow(false);
      setDownloadProgress(null);
      setDownloading(false);
    }
  };

  const startRescanProgressSim = () => {
    setRescanProgress(4);
    clearInterval(rescanProgressTimerRef.current);
    rescanProgressTimerRef.current = setInterval(() => {
      setRescanProgress(p => {
        if (p >= 90) return p; // hold just short of full until the real result arrives
        const remaining = 90 - p;
        return Math.min(90, p + Math.max(0.6, remaining * 0.07));
      });
    }, 180);
  };

  const stopRescanProgressSim = (success) => {
    clearInterval(rescanProgressTimerRef.current);
    if (success) {
      setRescanProgress(100);
      setTimeout(() => setRescanProgress(0), 500);
    } else {
      setRescanProgress(0);
    }
  };

  const handleRescan = async (e) => {
    e.stopPropagation();
    if (rescanLockRef.current) return;
    rescanLockRef.current = true;
    setRescanning(true);
    startRescanProgressSim();

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
      stopRescanProgressSim(true);
      await onRescanned?.(res.data.data, analysis.id, !!res.data.cached);
    } catch (err) {
      stopRescanProgressSim(false);
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
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-heading)' }}>
              {analysis.project_name}
            </span>
            <a
              href={analysis.repo_url}
              target="_blank"
              rel="noreferrer"
              title="Open on GitHub"
              onClick={e => e.stopPropagation()}
              style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                       color: 'var(--text-muted)', borderRadius: 4, transition: 'var(--transition)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
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
                ref={exportBtnRef}
                onClick={toggleExportMenu}
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

              {exportMenuOpen && exportMenuPos && (
                <>
                  <div onClick={() => setExportMenuOpen(false)}
                       style={{ position: 'fixed', inset: 0, zIndex: 1000 }} />
                  <div style={{ position: 'fixed', top: exportMenuPos.top, right: exportMenuPos.right, zIndex: 1001,
                                background: 'var(--bg-card)', border: '1px solid var(--border)',
                                borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.16)',
                                minWidth: 160, overflow: 'hidden' }}>
                    <button
                      onClick={e => handleExport(e, 'markdown')}
                      style={{ width: '100%', textAlign: 'left', padding: '9px 12px',
                               fontSize: 12.5, background: 'none', border: 'none',
                               color: 'var(--text)', cursor: 'pointer', display: 'block' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
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
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
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
            <div style={{ position: 'relative' }}>
              <button
                onClick={rescanning ? handlePauseRescan : handleRescan}
                title={
                  rescanning
                    ? `Rescanning — ${Math.round(rescanProgress)}% (click to pause)`
                    : 'Check for updates (instant if nothing changed)'
                }
                style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent',
                  border: `1px solid ${rescanning ? 'var(--accent)' : 'var(--border)'}`,
                  color: rescanning ? 'var(--accent)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'var(--transition)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = rescanning ? 'var(--accent)' : 'var(--border)'; e.currentTarget.style.color = rescanning ? 'var(--accent)' : 'var(--text-muted)'; }}
              >
                {rescanning ? (
                  // Determinate-looking ring (simulated — see comment above
                  // rescanProgress state) with a tiny pause icon at its center,
                  // same visual language as the download ring below.
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    background: `conic-gradient(var(--accent) ${rescanProgress * 3.6}deg, rgba(79,126,248,0.18) 0deg)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s linear',
                  }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-card)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                      <span style={{ width: 1.5, height: 5, background: 'var(--accent)', borderRadius: 1 }} />
                      <span style={{ width: 1.5, height: 5, background: 'var(--accent)', borderRadius: 1 }} />
                    </div>
                  </div>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                  </svg>
                )}
              </button>

              {rescanning && (
                <div style={{
                  position: 'absolute', top: -22, right: 0, zIndex: 5,
                  fontSize: 10, fontWeight: 700, color: 'var(--accent)',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  padding: '1px 6px', borderRadius: 6, whiteSpace: 'nowrap',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                }}>
                  {Math.round(rescanProgress)}%
                </div>
              )}
            </div>
          )}

          {!isPending && !isFailed && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={handleDownload}
                disabled={downloading}
                title={
                  downloadProgress != null ? `Downloading — ${downloadProgress}%`
                  : downloadSlow ? 'Still fetching the repository — large repos can take a minute'
                  : 'Download repository as ZIP'
                }
                style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: downloading ? 'wait' : 'pointer', transition: 'var(--transition)' }}
                onMouseEnter={e => { if (!downloading) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; } }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)';  e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                {downloading ? (
                  downloadProgress != null ? (
                    // Determinate ring — fills clockwise as real bytes arrive,
                    // instead of a spinner that never actually tells you how
                    // much longer this is going to take.
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                      background: `conic-gradient(var(--accent) ${downloadProgress * 3.6}deg, rgba(79,126,248,0.18) 0deg)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.15s linear',
                    }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--bg-card)' }} />
                    </div>
                  ) : (
                    <span style={{ width: 13, height: 13, border: '2px solid rgba(79,126,248,0.25)',
                                   borderTopColor: 'var(--accent)', borderRadius: '50%',
                                   animation: 'spin 0.7s linear infinite', display: 'block' }} />
                  )
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                )}
              </button>

              {downloading && (
                <div style={{
                  position: 'absolute', top: -22, right: 0, zIndex: 5,
                  fontSize: 10, fontWeight: 700, color: 'var(--accent)',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  padding: '1px 6px', borderRadius: 6, whiteSpace: 'nowrap',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                }}>
                  {downloadProgress != null ? `${downloadProgress}%` : 'Fetching…'}
                </div>
              )}
            </div>
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
            <button
              onClick={() => setOpen(o => !o)}
              title={open ? 'Collapse' : 'Expand'}
              style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent',
                       border: '1px solid transparent', display: 'flex', alignItems: 'center',
                       justifyContent: 'center', color: 'var(--text-muted)', cursor: 'pointer',
                       transition: 'var(--transition)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2"
                   style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', animation: 'slideDown 0.2s ease' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)',
                        padding: '0 20px', overflowX: 'auto', background: 'var(--bg-subtle)' }}>
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
            {activeTab === 'chat' && (
              <AIChatTab analysisId={analysis.id} projectName={analysis.project_name} />
            )}
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

      {deleteConfirmOpen && (
        <>
          <div
            onClick={() => setDeleteConfirmOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,18,25,0.5)' }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 1001, width: 380, maxWidth: 'calc(100vw - 32px)',
            background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border)',
            boxShadow: '0 12px 40px rgba(15,23,42,0.22)', padding: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239,68,68,0.1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--grade-f)" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-heading)' }}>
                Delete this analysis?
              </div>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5, margin: '0 0 20px' }}>
              This permanently removes the analysis for <strong>{analysis.project_name}</strong>,
              including its report, scores, and findings. This can't be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                         border: '1px solid var(--border)', background: 'transparent',
                         color: 'var(--text-strong)', cursor: 'pointer', transition: 'var(--transition)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                         border: 'none', background: 'var(--grade-f)', color: '#fff',
                         cursor: 'pointer', transition: 'var(--transition)' }}
                onMouseEnter={e => { e.currentTarget.style.opacity = 0.9; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = 1; }}
              >
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
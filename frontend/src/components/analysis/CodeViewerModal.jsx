import React, { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * Fullscreen-ish overlay that fetches and displays a single file's source
 * from the backend's cloneless /file/ endpoint (GitHub raw content — no
 * git clone touches disk for this). Used from both the Project Structure
 * tree and the File Flow Chart when a file node is clicked.
 */
export default function CodeViewerModal({ analysisId, path, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, content: '', truncated: false });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, content: '', truncated: false });

    api.get(`analysis/${analysisId}/file/`, { params: { path } })
      .then(res => {
        if (cancelled) return;
        setState({ loading: false, error: null, content: res.data.content || '', truncated: !!res.data.truncated });
      })
      .catch(err => {
        if (cancelled) return;
        const msg = err?.response?.data?.error || 'Could not load this file.';
        setState({ loading: false, error: msg, content: '', truncated: false });
      });

    return () => { cancelled = true; };
  }, [analysisId, path]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,23,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000, padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 900,
                  maxHeight: '85vh', display: 'flex', flexDirection: 'column',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 14 }}>📄</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600,
                          color: 'var(--text-strong)', whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {path}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent',
                     border: '1px solid var(--border)', color: 'var(--text-muted)',
                     cursor: 'pointer', flexShrink: 0, fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1, background: '#0d1117' }}>
          {state.loading && (
            <div style={{ padding: 40, textAlign: 'center', color: '#8b949e', fontSize: 13 }}>
              Loading file…
            </div>
          )}
          {state.error && (
            <div style={{ padding: 40, textAlign: 'center', color: '#f97583', fontSize: 13 }}>
              {state.error}
            </div>
          )}
          {!state.loading && !state.error && (
            <pre style={{ margin: 0, padding: '16px 20px', fontFamily: 'var(--mono)',
                         fontSize: 12.5, lineHeight: 1.6, color: '#c9d1d9',
                         whiteSpace: 'pre', overflowX: 'auto' }}>
              <code className={`language-${ext}`}>{state.content}</code>
            </pre>
          )}
        </div>

        {state.truncated && (
          <div style={{ padding: '8px 18px', fontSize: 11.5, color: 'var(--text-muted)',
                        borderTop: '1px solid var(--border)', background: '#f8f9fb' }}>
            File is large — showing the first portion only.
          </div>
        )}
      </div>
    </div>
  );
}

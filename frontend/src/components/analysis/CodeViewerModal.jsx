import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';

/**
 * Fullscreen-ish overlay that fetches and displays a single file's source
 * from the backend's cloneless /file/ endpoint (GitHub raw content — no
 * git clone touches disk for this). Used from both the Project Structure
 * tree and the File Flow Chart when a file node is clicked.
 */
export default function CodeViewerModal({ analysisId, path, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, content: '', truncated: false });
  const dialogRef = useRef(null);
  const closeBtnRef = useRef(null);
  // Remember what had focus before the modal opened, so closing it
  // (Escape, backdrop click, or the × button) returns focus there
  // instead of silently dropping it back to <body> — important for
  // anyone navigating by keyboard/screen reader.
  const previouslyFocusedRef = useRef(null);

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

  // Focus management: move focus into the dialog on open, trap Tab/Shift+Tab
  // inside it while open, and restore focus to whatever triggered it on close.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    closeBtnRef.current?.focus();

    const onKey = e => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Guard: the trigger element may have been unmounted (e.g. the tree
      // it lived in re-rendered) — only refocus if it's still attached.
      if (previouslyFocusedRef.current && document.contains(previouslyFocusedRef.current)) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [onClose]);

  const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
  const titleId = 'code-viewer-title';

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,23,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000, padding: 24 }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 900,
                  maxHeight: '85vh', display: 'flex', flexDirection: 'column',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span aria-hidden="true" style={{ fontSize: 14 }}>📄</span>
            <span id={titleId} style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600,
                          color: 'var(--text-strong)', whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {path}
            </span>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close file viewer"
            style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent',
                     border: '1px solid var(--border)', color: 'var(--text-muted)',
                     cursor: 'pointer', flexShrink: 0, fontSize: 14, lineHeight: 1 }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1, background: '#0d1117' }}>
          {state.loading && (
            <div role="status" style={{ padding: 40, textAlign: 'center', color: '#8b949e', fontSize: 13 }}>
              Loading file…
            </div>
          )}
          {state.error && (
            <div role="alert" style={{ padding: 40, textAlign: 'center', color: '#f97583', fontSize: 13 }}>
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
                        borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
            File is large — showing the first portion only.
          </div>
        )}
      </div>
    </div>
  );
}
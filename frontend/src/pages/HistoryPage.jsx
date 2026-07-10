import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { StatusBadge } from '../components/ui/Badge';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { timeAgo } from '../utils/helpers';
import ThemeToggle from '../components/ui/ThemeToggle';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 20;

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '72px 24px', color: 'var(--text-muted)' }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
        background: 'rgba(79,126,248,0.08)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 28 }}>
        🕓
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 8 }}>
        No history yet
      </h3>
      <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
        Repositories you analyze from the dashboard will show up here.
      </p>
    </div>
  );
}

function HistoryRow({ a }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px',
      borderBottom: '1px solid var(--border)' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.project_name || 'Untitled repository'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
          {a.repo_url}
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0, width: 110, textAlign: 'right' }}
           title={a.created_at ? new Date(a.created_at).toLocaleString() : undefined}>
        {a.created_at ? timeAgo(a.created_at) : '—'}
      </div>

      <div style={{ flexShrink: 0, width: 130, textAlign: 'right' }}>
        <StatusBadge status={a.status} />
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { email } = useAuth();
  const navigate = useNavigate();
  const { toasts, removeToast, success, error: toastError } = useToast();

  const [analyses, setAnalyses] = useState([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchPage = useCallback(async (pageNum, { append = false } = {}) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const res = await api.get('analysis/', { params: { page: pageNum, page_size: PAGE_SIZE } });
      const results = res.data.results || [];
      setAnalyses(prev => append ? [...prev, ...results] : results);
      setCount(res.data.count ?? results.length);
      setTotalPages(res.data.total_pages ?? 1);
      setPage(pageNum);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Could not load history.');
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPage(1); }, [fetchPage]);

  const handleLoadMore = () => {
    if (loadingMore || page >= totalPages) return;
    fetchPage(page + 1, { append: true });
  };

  const handleClearHistory = async () => {
    setClearing(true);
    try {
      const res = await api.delete('analysis/clear/');
      setAnalyses([]);
      setCount(0);
      setTotalPages(0);
      setPage(1);
      success(
        res.data?.deleted
          ? `Cleared ${res.data.deleted} ${res.data.deleted === 1 ? 'entry' : 'entries'} from your history.`
          : 'History cleared.'
      );
    } catch (err) {
      toastError(err?.response?.data?.error || 'Could not clear history.');
    } finally {
      setClearing(false);
      setClearConfirmOpen(false);
    }
  };

  const filtered = analyses.filter(a =>
    !search
    || a.project_name?.toLowerCase().includes(search.toLowerCase())
    || a.repo_url?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ── Sticky header ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: 'var(--bg-header)',
        borderBottom: '1px solid var(--border)', backdropFilter: 'blur(8px)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '14px 32px',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>

          <button
            onClick={() => navigate('/dashboard')}
            aria-label="Back to dashboard"
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none',
              border: 'none', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', padding: '6px 8px', borderRadius: 'var(--radius)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-strong)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            Dashboard
          </button>

          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>
            History
          </h1>
          {count > 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)',
              background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
              borderRadius: 20, padding: '3px 10px' }}>
              {count} scan{count === 1 ? '' : 's'}
            </span>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            {analyses.length > 0 && (
              <button
                onClick={() => setClearConfirmOpen(true)}
                style={{ fontSize: 12, fontWeight: 600, color: 'var(--grade-f)',
                  background: 'transparent', border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}
              >
                Clear history
              </button>
            )}

            {email && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)',
                background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
                padding: '5px 12px', borderRadius: 20, display: 'flex',
                alignItems: 'center', gap: 6, maxWidth: 200, overflow: 'hidden' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--status-done)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {email}
                </span>
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>
        {analyses.length > 0 && (
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 style={{ position: 'absolute', left: 12, top: '50%',
                 transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" placeholder="Search history…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 34, paddingRight: 14, paddingTop: 9, paddingBottom: 9,
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                borderRadius: 8, color: 'var(--text-strong)', fontSize: 13, width: '100%' }} />
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)', fontSize: 13 }}>
            Loading…
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: 24, background: 'rgba(239,68,68,0.04)',
            border: '1px solid rgba(239,68,68,0.18)', borderRadius: 12, color: 'var(--text-muted)' }}>
            {error}
          </div>
        )}

        {!loading && !error && analyses.length === 0 && <EmptyState />}

        {!loading && !error && filtered.length > 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden' }}>
            {filtered.map(a => <HistoryRow key={a.id} a={a} />)}
          </div>
        )}

        {!loading && !error && analyses.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            No history matches "<strong style={{ color: 'var(--text)' }}>{search}</strong>"
          </div>
        )}

        {!loading && !error && !search && page < totalPages && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 20px', cursor: loadingMore ? 'wait' : 'pointer' }}
            >
              {loadingMore ? 'Loading…' : `Load more (${count - analyses.length} remaining)`}
            </button>
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {clearConfirmOpen && (
        <div
          onClick={() => !clearing && setClearConfirmOpen(false)}
          role="presentation"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,23,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24 }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-history-title"
            aria-describedby="clear-history-desc"
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 400,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: 24 }}
          >
            <h2 id="clear-history-title" style={{ fontSize: 16, fontWeight: 700,
              color: 'var(--text-strong)', marginBottom: 8 }}>
              Clear your entire history?
            </h2>
            <p id="clear-history-desc" style={{ fontSize: 13, color: 'var(--text-muted)',
              lineHeight: 1.5, marginBottom: 20 }}>
              This permanently deletes all {count} analysis result{count === 1 ? '' : 's'} on
              your account, including cached reports. This can't be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setClearConfirmOpen(false)}
                disabled={clearing}
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)',
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '8px 16px', cursor: clearing ? 'default' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleClearHistory}
                disabled={clearing}
                style={{ fontSize: 13, fontWeight: 600, color: '#fff',
                  background: 'var(--grade-f)', border: 'none',
                  borderRadius: 8, padding: '8px 16px', cursor: clearing ? 'wait' : 'pointer',
                  opacity: clearing ? 0.7 : 1 }}
              >
                {clearing ? 'Clearing…' : 'Clear history'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
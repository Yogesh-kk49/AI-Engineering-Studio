import React, { useState, useCallback, useEffect } from 'react';
import RepositoryForm from '../components/RepositoryForm';
import AnalysisCard   from '../components/AnalysisCard';
import { SkeletonCard } from '../components/ui/Skeleton';
import { ToastContainer } from '../components/ui/Toast';
import { useToast }    from '../hooks/useToast';
import { useAnalyses, isAnalysisInProgress } from '../hooks/useAnalyses';
import { normalizeRepoUrl } from '../utils/helpers';
import ThemeToggle from '../components/ui/ThemeToggle';

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', padding: '72px 24px', color: 'var(--text-muted)' }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px',
        background: 'rgba(79,126,248,0.08)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 28 }}>
        📊
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 8 }}>
        No repositories analyzed yet
      </h3>
      <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
        Paste a public GitHub URL above and click Analyze. Results appear here in real-time.
      </p>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div style={{ padding: 24, background: 'rgba(239,68,68,0.04)',
      border: '1px solid rgba(239,68,68,0.18)', borderRadius: 12,
      display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: 'rgba(239,68,68,0.10)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--grade-f)', fontSize: 16 }}>⚠</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--grade-f)', marginBottom: 4 }}>
          Backend unreachable
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{message}</div>
        <code style={{ display: 'inline-block', marginTop: 8, fontSize: 12,
          fontFamily: 'var(--mono)', background: 'var(--bg-card-hover)',
          padding: '6px 10px', borderRadius: 6, color: 'var(--text)' }}>
          cd backend && python manage.py runserver
        </code>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { toasts, removeToast, success, error: toastError, info } = useToast();
  const { analyses, loading, error, refresh, deleteAnalysis }     = useAnalyses();
  const [search, setSearch] = useState('');
  const toast = { success, error: toastError, info };

  // ── Display order ───────────────────────────────────────────────────
  // The backend always returns analyses newest-first by created_at, which
  // never changes for an existing row. To support "move this repo to the
  // top" (on a repeat submission or a rescan) without needing a backend
  // field for it, we keep our own ordering of ids on top of whatever the
  // backend returns, and only ever reorder it client-side.
  const [order, setOrder] = useState([]);

  useEffect(() => {
    setOrder(prev => {
      const ids = analyses.map(a => a.id);
      const kept = prev.filter(id => ids.includes(id));
      const fresh = ids.filter(id => !kept.includes(id)); // brand-new rows
      return [...fresh, ...kept];
    });
  }, [analyses]);

  const moveToTop = useCallback((id) => {
    setOrder(prev => [id, ...prev.filter(x => x !== id)]);
  }, []);

  const orderedAnalyses = order
    .map(id => analyses.find(a => a.id === id))
    .filter(Boolean);

  // Finds an existing history entry for a given repo URL, ignoring
  // protocol / "www." / ".git" / trailing-slash / casing differences.
  const findExistingByUrl = useCallback((url) => {
    const norm = normalizeRepoUrl(url);
    return analyses.find(a => normalizeRepoUrl(a.repo_url) === norm) || null;
  }, [analyses]);

  const handleAnalysisStarted = useCallback((data) => {
    refresh();
    if (data?.id) moveToTop(data.id);
  }, [refresh, moveToTop]);

  const handleAlreadyScanned = useCallback((existing) => {
    moveToTop(existing.id);
  }, [moveToTop]);

  // Called after a card's "Rescan" action completes.
  //  • cached === true  → the repo's latest commit matched what we already
  //    had, so the backend returned the existing result instantly. Nothing
  //    to clean up — just bump it to the top and say so.
  //  • cached === false → there was a real new commit, so the backend
  //    cloned + re-ran the full pipeline into a fresh row. Once that lands
  //    we drop the stale row so each repo keeps a single, current entry.
  const handleRescanned = useCallback(async (newData, oldId, cached) => {
    if (cached) {
      if (newData?.id) moveToTop(newData.id);
      info(`"${newData?.project_name || 'Repository'}" is already up to date — no new commits found.`);
      return;
    }
    if (newData?.id && newData.id !== oldId) {
      // Guard against a race: if the old card was acted on twice in quick
      // succession (e.g. a rescan fired again before this cleanup's
      // refresh() landed), a previous cycle may have already deleted this
      // row. Skip the request entirely instead of sending a DELETE for an
      // id that's already gone.
      const stillPresent = analyses.some(a => a.id === oldId);
      if (stillPresent) {
        await deleteAnalysis(oldId);
      }
    }
    await refresh();
    if (newData?.id) moveToTop(newData.id);
    success(`New commits found for "${newData?.project_name || 'repository'}" — re-analyzing now.`);
  }, [analyses, deleteAnalysis, refresh, moveToTop, success, info]);

  const handleDelete = useCallback(async (id) => {
    const ok = await deleteAnalysis(id);
    ok ? success('Analysis deleted') : toastError('Failed to delete');
  }, [deleteAnalysis, success, toastError]);

  const filtered  = orderedAnalyses.filter(a =>
    !search || a.project_name?.toLowerCase().includes(search.toLowerCase()));
  const pending   = analyses.filter(isAnalysisInProgress).length;
  const completed = analyses.filter(a => a.status === 'Completed').length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ── Sticky header ── */}
      <header style={{
        borderBottom: '1px solid var(--border)',
        padding: '0 32px',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 100,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex',
                      alignItems: 'center', height: 60, gap: 16 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg,#4f7ef8,#2563eb)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                   stroke="white" strokeWidth="2.5">
                <circle cx="12" cy="12" r="3"/>
                <path d="M3 12h1M20 12h1M12 3v1M12 20v1M6.34 6.34l.7.7M16.97 16.97l.7.7M6.34 17.66l.7-.7M16.97 7.03l.7-.7"/>
              </svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-heading)',
                           letterSpacing: '-0.02em' }}>
              AI Engineering Studio
            </span>
          </div>

          {/* Live status pills */}
          {!loading && !error && (
            <div style={{ display: 'flex', gap: 8, marginLeft: 24 }}>
              {completed > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)',
                  background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
                  padding: '3px 10px', borderRadius: 20 }}>{completed} analyzed</span>
              )}
              {pending > 0 && (
                <span style={{ fontSize: 12, color: 'var(--status-pending)',
                  background: 'var(--status-pending-bg)', padding: '3px 10px', borderRadius: 20,
                  display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%',
                    background: 'currentColor', animation: 'pulse 1.2s infinite' }} />
                  {pending} running
                </span>
              )}
            </div>
          )}

          <div style={{ marginLeft: 'auto' }}>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 32px' }}>
        {/* Hero */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20,
            fontSize: 12, fontWeight: 600, color: 'var(--accent)',
            background: 'var(--accent-glow)', border: '1px solid rgba(79,126,248,0.2)',
            padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%',
                           background: 'var(--accent)', animation: 'pulse 2s infinite' }} />
            AI-Powered Repository Analysis
          </div>

          <h1 style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-heading)',
                       letterSpacing: '-0.03em', lineHeight: 1.2, marginBottom: 12 }}>
            Understand any codebase<br />
            <span style={{ background: 'linear-gradient(135deg,#4f7ef8,#0ea5e9)',
                           WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                           backgroundClip: 'text' }}>in seconds</span>
          </h1>

          <p style={{ fontSize: 16, color: 'var(--text-muted)', lineHeight: 1.7,
                      maxWidth: 560, marginBottom: 32 }}>
            Analyze architecture, security, code quality, and dependencies
            from any public GitHub repository.
          </p>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-lg)', padding: '20px 24px',
                        boxShadow: 'var(--shadow-card)' }}>
            <RepositoryForm
              onAnalysisStarted={handleAnalysisStarted}
              toast={toast}
              findExistingByUrl={findExistingByUrl}
              onAlreadyScanned={handleAlreadyScanned}
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              Works with any public GitHub repository. Analysis takes 30–90 seconds.
            </p>
          </div>
        </div>

        {/* Results */}
        {analyses.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading)' }}>
              Analysis History
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 10 }}>
                {analyses.length} total
              </span>
            </h2>
            <div style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2" style={{ position: 'absolute', left: 10, top: '50%',
                   transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" placeholder="Search repositories…"
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ paddingLeft: 32, paddingRight: 14, paddingTop: 8, paddingBottom: 8,
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  borderRadius: 8, color: 'var(--text-strong)', fontSize: 13, width: 220 }} />
            </div>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SkeletonCard /><SkeletonCard />
          </div>
        )}

        {!loading && error   && <ErrorState message={error} />}
        {!loading && !error && analyses.length === 0 && <EmptyState />}

        {!loading && !error && filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(a => (
              <AnalysisCard key={a.id} analysis={a} onDelete={handleDelete} onRescanned={handleRescanned} toast={toast} />
            ))}
          </div>
        )}

        {!loading && !error && analyses.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            No repositories match "<strong style={{ color: 'var(--text)' }}>{search}</strong>"
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
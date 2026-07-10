import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import RepositoryForm from '../components/RepositoryForm';
import AnalysisCard   from '../components/AnalysisCard';
import { SkeletonCard } from '../components/ui/Skeleton';
import { ToastContainer } from '../components/ui/Toast';
import { useToast }    from '../hooks/useToast';
import { useAnalyses, isAnalysisInProgress } from '../hooks/useAnalyses';
import { normalizeRepoUrl } from '../utils/helpers';
import ThemeToggle from '../components/ui/ThemeToggle';
import { useAuth } from '../context/AuthContext';

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
  const { email, logout } = useAuth();
  const navigate = useNavigate();
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/', { replace: true });
    } finally {
      setLoggingOut(false);
      setLogoutConfirmOpen(false);
    }
  }, [logout, navigate]);
  const { toasts, removeToast, success, error: toastError, info } = useToast();
  const { analyses, loading, error, refresh, deleteAnalysis, patchAnalysis } = useAnalyses();
  const [search, setSearch] = useState('');
  const [scanMode, setScanMode] = useState('basic'); // tracks the mode currently selected in RepositoryForm, so the time estimate below matches it
  const toast = { success, error: toastError, info };

  // ── One card per repo ───────────────────────────────────────────────
  // Rescanning a repo used to delete its previous row outright so the
  // dashboard never showed duplicates. That silently broke the Trend and
  // Compare tabs — there was never more than one saved scan per repo to
  // compare against, ever. Every scan is now kept permanently; instead,
  // *this list* collapses to the most recent scan per repo (by the same
  // URL-normalization used for duplicate detection elsewhere), so the
  // dashboard still shows one card per repo while the full history lives
  // on in the backend for Trend/Compare (and on the dedicated History page).
  const latestPerRepo = useMemo(() => {
    const byRepo = new Map();
    for (const a of analyses) {
      const key = normalizeRepoUrl(a.repo_url);
      const existing = byRepo.get(key);
      if (!existing || new Date(a.created_at) > new Date(existing.created_at)) {
        byRepo.set(key, a);
      }
    }
    return Array.from(byRepo.values());
  }, [analyses]);

  // ── Display order ───────────────────────────────────────────────────
  // The backend always returns analyses newest-first by created_at, which
  // never changes for an existing row. To support "move this repo to the
  // top" (on a repeat submission or a rescan) without needing a backend
  // field for it, we keep our own ordering of ids on top of whatever the
  // backend returns, and only ever reorder it client-side.
  const [order, setOrder] = useState([]);

  useEffect(() => {
    setOrder(prev => {
      const ids = latestPerRepo.map(a => a.id);
      const kept = prev.filter(id => ids.includes(id));
      const fresh = ids.filter(id => !kept.includes(id)); // brand-new rows
      return [...fresh, ...kept];
    });
  }, [latestPerRepo]);

  const moveToTop = useCallback((id) => {
    setOrder(prev => [id, ...prev.filter(x => x !== id)]);
  }, []);

  const orderedAnalyses = order
    .map(id => latestPerRepo.find(a => a.id === id))
    .filter(Boolean);

  // Finds an existing history entry for a given repo URL, ignoring
  // protocol / "www." / ".git" / trailing-slash / casing differences.
  const findExistingByUrl = useCallback((url) => {
    const norm = normalizeRepoUrl(url);
    return latestPerRepo.find(a => normalizeRepoUrl(a.repo_url) === norm) || null;
  }, [latestPerRepo]);

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
  //    cloned + re-ran the full pipeline into a fresh row. The old row is
  //    kept (not deleted) so Trend/Compare have something to measure
  //    against — `latestPerRepo` above is what keeps this list showing
  //    only the newest one.
  const handleRescanned = useCallback(async (newData, oldId, cached) => {
    if (cached) {
      if (newData?.id) moveToTop(newData.id);
      info(`"${newData?.project_name || 'Repository'}" is already up to date — no new commits found.`);
      return;
    }
    await refresh();
    if (newData?.id) moveToTop(newData.id);
    success(`New commits found for "${newData?.project_name || 'repository'}" — re-analyzing now.`);
  }, [refresh, moveToTop, success, info]);

  const handleDelete = useCallback(async (id) => {
    const ok = await deleteAnalysis(id);
    ok ? success('Analysis deleted') : toastError('Failed to delete');
  }, [deleteAnalysis, success, toastError]);

  const filtered  = orderedAnalyses.filter(a =>
    !search || a.project_name?.toLowerCase().includes(search.toLowerCase()));
  const pending   = latestPerRepo.filter(isAnalysisInProgress).length;
  const completed = latestPerRepo.filter(a => a.status === 'Completed').length;

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

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => navigate('/history')}
              title="View history"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 8, padding: '6px 12px', cursor: 'pointer', transition: 'var(--transition)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9"/>
                <polyline points="12 7 12 12 16 14"/>
              </svg>
              History
            </button>
            {email && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)',
                background: 'var(--bg-card-hover)', border: '1px solid var(--border)',
                padding: '5px 12px', borderRadius: 20, display: 'flex',
                alignItems: 'center', gap: 6, maxWidth: 220, overflow: 'hidden' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--status-done)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {email}
                </span>
              </span>
            )}
            <button
              onClick={() => setLogoutConfirmOpen(true)}
              title="Log out"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                background: 'transparent', border: '1px solid var(--border)',
                borderRadius: 8, padding: '6px 12px', transition: 'var(--transition)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--grade-f)'; e.currentTarget.style.color = 'var(--grade-f)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              Log out
            </button>
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
              onScanModeChange={setScanMode}
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              Works with any public GitHub repository.{' '}
              {scanMode === 'deep'
                ? 'Deep Scan takes 30–90+ seconds depending on repo size.'
                : 'Basic Scan takes 1–5 seconds — no cloning required.'}
            </p>
          </div>
        </div>

        {/* Results */}
        {latestPerRepo.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading)' }}>
              Analysis History
              <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 10 }}>
                {latestPerRepo.length} total
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
        {!loading && !error && latestPerRepo.length === 0 && <EmptyState />}

        {!loading && !error && filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map(a => (
              <AnalysisCard key={a.id} analysis={a} onDelete={handleDelete} onRescanned={handleRescanned} onFullDataLoaded={patchAnalysis} toast={toast} />
            ))}
          </div>
        )}

        {!loading && !error && latestPerRepo.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            No repositories match "<strong style={{ color: 'var(--text)' }}>{search}</strong>"
          </div>
        )}
      </main>

      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {logoutConfirmOpen && (
        <div
          onClick={() => !loggingOut && setLogoutConfirmOpen(false)}
          role="presentation"
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,23,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 24 }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
            aria-describedby="logout-confirm-desc"
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', borderRadius: 12, width: '100%', maxWidth: 380,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: 24 }}
          >
            <h2 id="logout-confirm-title" style={{ fontSize: 16, fontWeight: 700,
              color: 'var(--text-strong)', marginBottom: 8 }}>
              Log out?
            </h2>
            <p id="logout-confirm-desc" style={{ fontSize: 13, color: 'var(--text-muted)',
              lineHeight: 1.5, marginBottom: 20 }}>
              You'll need to verify your email with a new code to sign back in.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setLogoutConfirmOpen(false)}
                disabled={loggingOut}
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)',
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '8px 16px', cursor: loggingOut ? 'default' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                style={{ fontSize: 13, fontWeight: 600, color: '#fff',
                  background: 'var(--grade-f)', border: 'none',
                  borderRadius: 8, padding: '8px 16px', cursor: loggingOut ? 'wait' : 'pointer',
                  opacity: loggingOut ? 0.7 : 1 }}
              >
                {loggingOut ? 'Logging out…' : 'Log out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
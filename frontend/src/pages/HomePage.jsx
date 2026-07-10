import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ui/ThemeToggle';

const FEATURES = [
  {
    icon: '🏗️',
    title: 'Architecture insights',
    desc: 'Visualize module structure, dependency graphs, and design patterns at a glance.',
  },
  {
    icon: '🛡️',
    title: 'Security scanning',
    desc: 'Surface vulnerable dependencies, secrets, and risky patterns before they ship.',
  },
  {
    icon: '📈',
    title: 'Quality scoring',
    desc: 'Composite health scores and hotspots so you know exactly where to focus.',
  },
  {
    icon: '💬',
    title: 'AI chat on your repo',
    desc: 'Ask questions about any analyzed repository and get answers grounded in the real code.',
  },
];

function NavBar() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  return (
    <header style={{ borderBottom: '1px solid var(--border)', padding: '0 32px',
      background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
      position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex',
        alignItems: 'center', height: 64, gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg,#4f7ef8,#2563eb)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <circle cx="12" cy="12" r="3"/>
              <path d="M3 12h1M20 12h1M12 3v1M12 20v1M6.34 6.34l.7.7M16.97 16.97l.7.7M6.34 17.66l.7-.7M16.97 7.03l.7-.7"/>
            </svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-heading)',
            letterSpacing: '-0.02em' }}>
            AI Engineering Studio
          </span>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <ThemeToggle />
          <button
            onClick={() => navigate(isAuthenticated ? '/dashboard' : '/login')}
            style={{ padding: '9px 18px', borderRadius: 'var(--radius)',
              background: 'linear-gradient(135deg,#4f7ef8,#2563eb)', color: '#fff',
              fontWeight: 600, fontSize: 13 }}>
            {isAuthenticated ? 'Go to Dashboard' : 'Sign In'}
          </button>
        </div>
      </div>
    </header>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleCta = () => navigate(isAuthenticated ? '/dashboard' : '/login');

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <NavBar />

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 32px 64px' }}>
        <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 64px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 20,
            fontSize: 12, fontWeight: 600, color: 'var(--accent)',
            background: 'var(--accent-glow)', border: '1px solid rgba(79,126,248,0.2)',
            padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent)', animation: 'pulse 2s infinite' }} />
            AI-Powered Repository Analysis
          </div>

          <h1 style={{ fontSize: 44, fontWeight: 800, color: 'var(--text-heading)',
            letterSpacing: '-0.03em', lineHeight: 1.15, marginBottom: 18 }}>
            Understand any codebase<br />
            <span style={{ background: 'linear-gradient(135deg,#4f7ef8,#0ea5e9)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text' }}>in seconds</span>
          </h1>

          <p style={{ fontSize: 17, color: 'var(--text-muted)', lineHeight: 1.7,
            maxWidth: 560, margin: '0 auto 32px' }}>
            Paste any public GitHub URL and get architecture, security, code
            quality, and dependency analysis — plus an AI reviewer you can
            chat with about the results. Every scan is saved to your own
            private history.
          </p>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              onClick={handleCta}
              style={{ padding: '13px 28px', borderRadius: 'var(--radius)',
                background: 'linear-gradient(135deg,#4f7ef8,#2563eb)', color: '#fff',
                fontWeight: 700, fontSize: 15, boxShadow: 'var(--shadow-card)' }}>
              {isAuthenticated ? 'Go to Dashboard →' : 'Get Started — it\'s free →'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 12 }}>
            No password needed-sign in with a one-time email code.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 20 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '24px 22px', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ fontSize: 26, marginBottom: 14 }}>{f.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 8 }}>
                {f.title}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </main>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px 32px',
        textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
        Works with any public GitHub repository.
      </footer>
    </div>
  );
}
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ui/ThemeToggle';
import { Link } from 'react-router-dom';

const FAQS = [
  {
    q: 'How do I analyze a repository?',
    a: 'On the Dashboard, paste the URL of any public GitHub repository into the input field and choose a Basic or Deep scan. Basic scans run faster and cover the essentials; Deep scans run every analysis dimension (quality, security, architecture, dependencies) in full.',
  },
  {
    q: "What's the difference between Basic and Deep scans?",
    a: 'Basic scans are optimized for speed and give you a quick health snapshot. Deep scans take longer but produce a much more thorough report, including detailed dependency graphs, security findings, and architectural insights.',
  },
  {
    q: 'Can I analyze private repositories?',
    a: 'Currently only public GitHub repositories are supported. Support for private repositories via personal access tokens may be added in the future.',
  },
  {
    q: 'How do I chat with the AI about my repository?',
    a: 'Once a scan finishes, open it from your Dashboard or History page and use the built-in AI chat panel. You can ask questions about the codebase and get answers grounded in the actual analyzed files.',
  },
  {
    q: 'Where can I see my past analyses?',
    a: 'All of your scans are saved to your account and available on the History page, where you can revisit reports, re-open the AI chat, or export results.',
  },
  {
    q: 'Can I export a report?',
    a: 'Yes. Completed analyses can be exported as PDF or Markdown from the report view, including all sections covered by the scan.',
  },
  {
    q: 'How do I sign in?',
    a: 'AI Engineering Studio uses passwordless sign-in. Enter your email on the login page and we\u2019ll send you a one-time code to authenticate \u2014 no password required.',
  },
  {
    q: 'Is my data private?',
    a: 'Your scan history and account data are private to your account. Analyzed repository content is only used to generate your reports and power the AI chat for that scan.',
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
        <div
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
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

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link to="/help" style={{ fontSize: 13, fontWeight: 600, color: '#0ea5e9' }}>
            Help
          </Link>
          <Link to="/terms" style={{ fontSize: 13, fontWeight: 600, color: '#0ea5e9' }}>
            Terms &amp; Conditions
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '18px 22px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, background: 'transparent', color: 'var(--text-heading)',
          fontSize: 14, fontWeight: 600 }}>
        {q}
        <span style={{ fontSize: 16, color: 'var(--text-muted)',
          transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 0.15s ease' }}>
          +
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 22px 18px', fontSize: 13, color: 'var(--text-muted)',
          lineHeight: 1.7 }}>
          {a}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <NavBar />

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '64px 32px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-heading)',
            letterSpacing: '-0.02em', marginBottom: 12 }}>
            Help &amp; FAQ
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-muted)' }}>
            Answers to common questions about using AI Engineering Studio.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {FAQS.map((item) => (
            <FaqItem key={item.q} q={item.q} a={item.a} />
          ))}
        </div>

        <div style={{ marginTop: 48, textAlign: 'center', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          padding: '28px 24px' }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-heading)', marginBottom: 8 }}>
            Still need help?
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
            Reach out and we'll get back to you as soon as we can.
          </p>
          <button
            onClick={() => navigate('/')}
            style={{ padding: '10px 20px', borderRadius: 'var(--radius)',
              background: 'linear-gradient(135deg,#4f7ef8,#2563eb)', color: '#fff',
              fontWeight: 600, fontSize: 13 }}>
            Back to Home
          </button>
        </div>
      </main>

      <footer style={{ borderTop: '1px solid var(--border)', padding: '24px 32px',
        textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
        Works with any public GitHub repository.
      </footer>
    </div>
  );
}
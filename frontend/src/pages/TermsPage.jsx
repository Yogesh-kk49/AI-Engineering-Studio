import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ui/ThemeToggle';
import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    body: 'By accessing or using AI Engineering Studio ("the Service"), you agree to be bound by these Terms & Conditions. If you do not agree with any part of these terms, please do not use the Service.',
  },
  {
    title: '2. Description of Service',
    body: 'AI Engineering Studio analyzes publicly accessible GitHub repositories and provides automated reports covering code quality, security, architecture, and dependencies, along with an AI-powered chat feature for discussing analysis results. The Service is provided for informational and educational purposes only.',
  },
  {
    title: '3. Account Registration',
    body: 'To access certain features, you must sign in using a valid email address and a one-time verification code. You are responsible for maintaining the security of your account and for all activity that occurs under it.',
  },
  {
    title: '4. Acceptable Use',
    body: 'You agree to use the Service only for lawful purposes. You may not use the Service to analyze repositories you do not have the right to access, attempt to disrupt or overload the platform, or use automated tools to abuse the analysis pipeline or rate limits.',
  },
  {
    title: '5. Analysis Accuracy',
    body: 'Analysis results, including quality scores, security findings, and AI-generated chat responses, are produced automatically and may contain errors or omissions. The Service should not be relied upon as the sole basis for security, architectural, or business decisions.',
  },
  {
    title: '6. Third-Party Content',
    body: 'Repositories analyzed through the Service belong to their respective owners. AI Engineering Studio does not claim ownership of any third-party code and accesses only what is publicly available via GitHub.',
  },
  {
    title: '7. AI-Generated Content',
    body: 'Chat responses and generated insights are produced using third-party AI models. These outputs are provided "as is" without warranty of accuracy, completeness, or fitness for a particular purpose.',
  },
  {
    title: '8. Data & Privacy',
    body: 'Your account information and scan history are stored to provide the Service to you. We do not sell your personal data. Analyzed repository content is processed only to generate your reports and power the associated AI chat.',
  },
  {
    title: '9. Limitation of Liability',
    body: 'The Service is provided "as is" without warranties of any kind. To the fullest extent permitted by law, AI Engineering Studio and its operators shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.',
  },
  {
    title: '10. Changes to These Terms',
    body: 'These Terms & Conditions may be updated from time to time. Continued use of the Service after changes are posted constitutes acceptance of the revised terms.',
  },
  {
    title: '11. Contact',
    body: 'If you have questions about these Terms & Conditions, please reach out through the Help page.',
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

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <NavBar />

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '64px 32px 80px' }}>
        <button
          onClick={() => navigate(-1)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 13, fontWeight: 600, color: 'var(--text-muted)',
            background: 'transparent', marginBottom: 28 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back
        </button>

        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-heading)',
            letterSpacing: '-0.02em', marginBottom: 12 }}>
            Terms &amp; Conditions
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>
            Last updated: July 2026
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-heading)',
                marginBottom: 8 }}>
                {s.title}
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.75 }}>
                {s.body}
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
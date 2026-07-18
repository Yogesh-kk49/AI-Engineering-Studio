import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ui/ThemeToggle';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Loads Google's Identity Services script once and resolves when it's
// ready to use. Safe to call multiple times — later calls reuse the
// same in-flight/completed load instead of injecting duplicate <script>
// tags.
let googleScriptPromise = null;
function loadGoogleScript() {
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

function GoogleSignInButton({ onCredential, onError }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'continue_with',
        });
      })
      .catch(() => onError?.('Could not load Google Sign-In. Please refresh and try again.'));

    return () => { cancelled = true; };
  }, [onCredential, onError]);

  return <div ref={buttonRef} style={{ display: 'flex', justifyContent: 'center' }} />;
}

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg,#4f7ef8,#2563eb)' }}>
        <img src="/yk-icon.png" alt="YK" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading)', letterSpacing: '-0.02em' }}>
        AI Engineering Studio
      </span>
    </div>
  );
}

export default function AuthPage() {
  const { googleLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleCredential = async (credential) => {
    setError('');
    setLoading(true);
    try {
      await googleLogin(credential);
      const redirectTo = location.state?.from?.pathname || '/dashboard';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex',
      flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 24px', flexWrap: 'wrap', gap: 12 }}>
        <button
          onClick={() => navigate('/')}
          aria-label="Back to home"
          style={{ display: 'flex',
            alignItems: 'center', gap: 6, background: 'none', border: 'none',
            color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            padding: '6px 10px', borderRadius: 'var(--radius)', transition: 'var(--transition)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-strong)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
          Back
        </button>

        <ThemeToggle />
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px' }}>
        <div style={{ width: '100%', maxWidth: 400, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-elevated)', padding: '36px 32px' }}
          className="animate-fade">
          <Logo />

          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)',
            textAlign: 'center', marginBottom: 6 }}>
            Sign in to continue
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 28 }}>
            Use your Google account — no password, no email code.
          </p>

          {GOOGLE_CLIENT_ID ? (
            <GoogleSignInButton onCredential={handleGoogleCredential} onError={setError} />
          ) : (
            <div style={{ fontSize: 13, color: 'var(--status-pending)',
              background: 'var(--status-pending-bg)', borderRadius: 8,
              padding: '10px 12px', textAlign: 'center' }}>
              Google sign-in isn't configured yet — set VITE_GOOGLE_CLIENT_ID.
            </div>
          )}

          {loading && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginTop: 16 }}>
              Signing you in…
            </div>
          )}
          {error && (
            <div style={{ fontSize: 13, color: 'var(--grade-f)', textAlign: 'center', marginTop: 16 }}>
              {error}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 6, padding: '0 24px 24px' }}>
        <img src="/yk-logo-full.png" alt="YK Product" style={{ height: 34, objectFit: 'contain', opacity: 0.9 }} />
        <span style={{ fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' }}>
          © {new Date().getFullYear()} YK Product. All rights reserved.
        </span>
      </div>
    </div>
  );
}
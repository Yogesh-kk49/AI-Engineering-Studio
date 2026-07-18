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

// Google's credential is a signed JWT — the backend verifies the
// signature server-side before trusting anything in it (see
// AuthContext.googleLogin), but we decode the payload client-side too,
// purely to show "Continue as {name}" before actually signing in. Never
// trust this decoded copy for anything security-sensitive.
function decodeJwtPayload(jwt) {
  try {
    const base64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
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
          // Without this, Google can silently re-sign-in a returning user
          // the instant the button mounts (no click, no account picker) if
          // the browser already has one Google session active for this
          // site — that's what looked like "it just picks an account for
          // me". Forcing this off means nothing happens until the person
          // actually clicks the button below.
          auto_select: false,
          cancel_on_tap_outside: true,
          // FedCM-enabled browsers rewrite the button itself into a
          // personalized "Sign in as {cached name}" chip once there's an
          // active Google session for this site — that's the screenshot:
          // the button skipped the neutral state and jumped straight to a
          // specific account with only a small chevron to switch. Turning
          // FedCM off for the button keeps it on the classic, always-
          // neutral "Sign in with Google" rendering, and clicking it opens
          // Google's normal full account chooser instead of pre-filling one.
          use_fedcm_for_button: false,
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: 'signin_with',
          logo_alignment: 'left',
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
  // Set once Google hands back a credential, cleared once the user
  // explicitly confirms (or backs out to pick another account). Nothing
  // is sent to our backend / no redirect happens until they hit Continue.
  const [pendingAccount, setPendingAccount] = useState(null); // { credential, name, email, picture }

  const handleGoogleCredential = (credential) => {
    setError('');
    const payload = decodeJwtPayload(credential);
    setPendingAccount({
      credential,
      name: payload?.name || payload?.email || 'your Google account',
      email: payload?.email || '',
      picture: payload?.picture || '',
    });
  };

  const handleContinue = async () => {
    if (!pendingAccount) return;
    setError('');
    setLoading(true);
    try {
      await googleLogin(pendingAccount.credential);
      const redirectTo = location.state?.from?.pathname || '/dashboard';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Google sign-in failed. Please try again.');
      setLoading(false);
    }
  };

  // Lets the user back out of the confirmation screen and pick a
  // different Google account instead of being stuck with the one they
  // first selected.
  const handleUseDifferentAccount = () => {
    setPendingAccount(null);
    setError('');
    window.google?.accounts?.id?.disableAutoSelect?.();
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

          {pendingAccount ? (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)',
                textAlign: 'center', marginBottom: 20 }}>
                Continue as {pendingAccount.name}?
              </h1>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 'var(--radius)',
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                marginBottom: 20 }}>
                {pendingAccount.picture ? (
                  <img src={pendingAccount.picture} alt="" referrerPolicy="no-referrer"
                    style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg,#4f7ef8,#2563eb)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 14 }}>
                    {pendingAccount.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-strong)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pendingAccount.name}
                  </div>
                  {pendingAccount.email && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pendingAccount.email}
                    </div>
                  )}
                </div>
              </div>

              <button
                onClick={handleContinue}
                disabled={loading}
                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius)',
                  background: loading ? 'rgba(79,126,248,0.5)' : 'linear-gradient(135deg,#4f7ef8,#2563eb)',
                  color: '#fff', fontWeight: 700, fontSize: 14,
                  cursor: loading ? 'wait' : 'pointer', marginBottom: 10 }}
              >
                {loading ? 'Signing you in…' : 'Continue'}
              </button>
              <button
                onClick={handleUseDifferentAccount}
                disabled={loading}
                style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius)',
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', fontWeight: 600, fontSize: 13,
                  cursor: loading ? 'default' : 'pointer' }}
              >
                Use a different account
              </button>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)',
                textAlign: 'center', marginBottom: 6 }}>
                Sign in to continue
              </h1>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 28 }}>
                Use your Google account-no password, no email code.
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
            </>
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
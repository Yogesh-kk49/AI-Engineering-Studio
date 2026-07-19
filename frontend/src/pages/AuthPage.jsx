import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ui/ThemeToggle';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// Same-origin static page (frontend/public/google-callback.html) that
// Google redirects the popup back to once the person picks an account.
// Must be added as an "Authorized redirect URI" for this OAuth client in
// Google Cloud Console → APIs & Services → Credentials, e.g.
//   https://your-frontend-domain.onrender.com/google-callback.html
//   http://localhost:5173/google-callback.html   (for local dev)
const REDIRECT_URI = `${window.location.origin}/google-callback.html`;

function randomToken() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Builds the classic Google OAuth "choose an account" page URL (the
// implicit response_type=id_token flow — no client secret involved,
// nothing ever touches a server on Google's side). prompt=select_account
// forces the account chooser to show even when there's only one signed-in
// account, so the person always gets an explicit, deliberate click here —
// this is the step that replaces Chrome's compact FedCM button chip,
// which couldn't be customized or skipped from the page's own code.
function buildGoogleAuthUrl(nonce, state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
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

// Opens Google's account chooser in a popup and resolves with the raw
// id_token once the person picks an account there. Rejects if they close
// the popup first, if popups are blocked, or if Google reports an error.
function signInWithGooglePopup() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) { reject(new Error('missing_client_id')); return; }

    const nonce = randomToken();
    const state = randomToken();
    const url = buildGoogleAuthUrl(nonce, state);

    const width = 460, height = 600;
    const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
    const popup = window.open(
      url, 'google-oauth-signin',
      `width=${width},height=${height},left=${left},top=${top}`
    );

    if (!popup) {
      reject(new Error('popup_blocked'));
      return;
    }

    let settled = false;
    const cleanup = () => {
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closeCheck);
    };

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== 'google-oauth-callback') return;
      cleanup();

      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      if (!event.data.idToken || event.data.state !== state) {
        reject(new Error('invalid_response'));
        return;
      }
      const payload = decodeJwtPayload(event.data.idToken);
      if (!payload || payload.nonce !== nonce) {
        reject(new Error('nonce_mismatch'));
        return;
      }
      resolve(event.data.idToken);
    };
    window.addEventListener('message', onMessage);

    // The popup gives us no event when the person just closes it without
    // finishing — poll for that so the "Signing in…" state doesn't hang
    // forever.
    const closeCheck = setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        reject(new Error('popup_closed'));
      }
    }, 400);
  });
}

function GoogleSignInButton({ onCredential, onError, disabled }) {
  const [opening, setOpening] = useState(false);

  const handleClick = async () => {
    if (!GOOGLE_CLIENT_ID) { onError?.('Google sign-in isn\u2019t configured yet.'); return; }
    setOpening(true);
    try {
      const idToken = await signInWithGooglePopup();
      onCredential(idToken);
    } catch (err) {
      if (err.message === 'popup_blocked') {
        onError?.('Your browser blocked the sign-in popup. Please allow popups for this site and try again.');
      } else if (err.message !== 'popup_closed') {
        onError?.('Google sign-in failed. Please try again.');
      }
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || opening}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '11px 16px', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', background: 'var(--bg-input)',
        color: 'var(--text-strong)', fontSize: 14, fontWeight: 600,
        cursor: disabled || opening ? 'default' : 'pointer', opacity: opening ? 0.7 : 1,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.02l7.73 6c4.51-4.18 7.09-10.36 7.09-17.49z"/>
        <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24 24 0 000 21.56l7.98-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.9l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      {opening ? 'Waiting for Google…' : 'Sign in with Google'}
    </button>
  );
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
  // first selected. Clicking "Sign in with Google" again reopens the
  // popup with prompt=select_account, so Google shows the chooser again.
  const handleUseDifferentAccount = () => {
    setPendingAccount(null);
    setError('');
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
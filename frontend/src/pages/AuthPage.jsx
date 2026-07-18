import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ui/ThemeToggle';

const RESEND_COOLDOWN = 30; // seconds — mirrors backend RESEND_COOLDOWN_SECONDS

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

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text-strong)',
  fontSize: 14,
};

const primaryButtonStyle = (disabled) => ({
  width: '100%',
  padding: '12px 14px',
  borderRadius: 'var(--radius)',
  background: disabled ? 'var(--border)' : 'linear-gradient(135deg,#4f7ef8,#2563eb)',
  color: disabled ? 'var(--text-muted)' : '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'var(--transition)',
});

export default function AuthPage() {
  const { requestOtp, verifyOtp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [devHint, setDevHint] = useState('');
  const otpInputRef = useRef(null);

  useEffect(() => {
    if (step === 'otp') otpInputRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async (e) => {
    e?.preventDefault();
    setError('');
    setInfo('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const data = await requestOtp(trimmed);
      setEmail(trimmed);
      setStep('otp');
      setOtp('');
      setInfo(data?.message || 'Verification code sent — check your inbox.');
      setCooldown(RESEND_COOLDOWN);
      // Backend only ever includes this when EMAIL_HOST_USER/PASSWORD
      // aren't configured — no real email was sent in that case, so show
      // the code directly instead of leaving the user staring at an
      // inbox that will never get anything.
      setDevHint(data?.debug_otp ? `No email is configured on the server — your code is ${data.debug_otp}` : '');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e) => {
    e?.preventDefault();
    setError('');
    if (otp.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    try {
      await verifyOtp(email, otp.trim());
      const redirectTo = location.state?.from?.pathname || '/dashboard';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || loading) return;
    await sendCode();
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

        {step === 'email' && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)',
              textAlign: 'center', marginBottom: 6 }}>
              Sign in to continue
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 24 }}>
              We'll email you a one-time code — no password needed.
            </p>

            <form onSubmit={sendCode}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600,
                color: 'var(--text)', marginBottom: 6 }}>
                Email address
              </label>
              <input
                type="email"
                autoFocus
                placeholder="you@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ ...inputStyle, marginBottom: 16 }}
              />

              {error && (
                <div style={{ fontSize: 13, color: 'var(--grade-f)', marginBottom: 14 }}>{error}</div>
              )}

              <button type="submit" disabled={loading} style={primaryButtonStyle(loading)}>
                {loading ? 'Sending code…' : 'Send verification code'}
              </button>
            </form>
          </>
        )}

        {step === 'otp' && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-heading)',
              textAlign: 'center', marginBottom: 6 }}>
              Enter your code
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 24 }}>
              Sent to <strong style={{ color: 'var(--text-strong)' }}>{email}</strong>
            </p>

            <form onSubmit={verifyCode}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600,
                color: 'var(--text)', marginBottom: 6 }}>
                6-digit code
              </label>
              <input
                ref={otpInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ ...inputStyle, marginBottom: 12, letterSpacing: 6,
                  textAlign: 'center', fontSize: 20, fontFamily: 'var(--mono)' }}
              />

              {info && !error && (
                <div style={{ fontSize: 13, color: 'var(--status-done)', marginBottom: 14 }}>{info}</div>
              )}
              {devHint && !error && (
                <div style={{ fontSize: 12, color: 'var(--status-pending)',
                  background: 'var(--status-pending-bg)', borderRadius: 8,
                  padding: '8px 10px', marginBottom: 14, fontFamily: 'var(--mono)' }}>
                  {devHint}
                </div>
              )}
              {error && (
                <div style={{ fontSize: 13, color: 'var(--grade-f)', marginBottom: 14 }}>{error}</div>
              )}

              <button type="submit" disabled={loading} style={primaryButtonStyle(loading)}>
                {loading ? 'Verifying…' : 'Verify & continue'}
              </button>
            </form>

            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginTop: 18 }}>
              <button
                onClick={() => { setStep('email'); setError(''); setInfo(''); setDevHint(''); }}
                style={{ background: 'none', color: 'var(--text-muted)', fontSize: 13 }}>
                ← Use a different email
              </button>
              <button
                onClick={resend}
                disabled={cooldown > 0 || loading}
                style={{ background: 'none', color: cooldown > 0 ? 'var(--text-faint)' : 'var(--accent)',
                  fontSize: 13, fontWeight: 600, cursor: cooldown > 0 ? 'not-allowed' : 'pointer' }}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </>
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
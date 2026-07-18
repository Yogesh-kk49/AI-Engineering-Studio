import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, { TOKEN_KEY, EMAIL_KEY } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [email, setEmail] = useState(() => localStorage.getItem(EMAIL_KEY));
  // "checking" covers the brief window on first load where we have a
  // saved token but haven't confirmed with the backend that it's still
  // valid yet — used to avoid flashing the login page for a split second
  // for an already-logged-in user.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (!savedToken) {
        setChecking(false);
        return;
      }
      try {
        const res = await api.get('accounts/me/');
        if (!cancelled) {
          setEmail(res.data.email);
          localStorage.setItem(EMAIL_KEY, res.data.email);
        }
      } catch {
        // Token's stale/revoked server-side — clear it so the user lands
        // on the login page instead of a dashboard full of failed requests.
        if (!cancelled) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(EMAIL_KEY);
          setToken(null);
          setEmail(null);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    restoreSession();
    return () => { cancelled = true; };
  }, []);

  // `credential` is the signed ID token Google's Identity Services button
  // hands back on successful sign-in — see AuthPage.jsx. The backend
  // verifies it server-side before trusting anything in it.
  const googleLogin = useCallback(async (credential) => {
    const res = await api.post('accounts/google/', { credential });
    const { token: newToken, email: confirmedEmail } = res.data;
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(EMAIL_KEY, confirmedEmail);
    setToken(newToken);
    setEmail(confirmedEmail);
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('accounts/logout/');
    } catch {
      // Token may already be invalid server-side — clearing it locally
      // still gets the user logged out either way.
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setToken(null);
    setEmail(null);
  }, []);

  const value = {
    token,
    email,
    isAuthenticated: Boolean(token),
    checking,
    googleLogin,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import './App.css';

function FullScreenLoader() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)', color: 'var(--text-muted)',
      fontSize: 14 }}>
      Loading…
    </div>
  );
}

// "/dashboard" is the only route that actually needs a session — the
// homepage and login page are both public (see below).
function RequireAuth({ children }) {
  const { isAuthenticated, checking } = useAuth();
  const location = useLocation();
  if (checking) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

// "/login" itself stays reachable at all times, but there's nothing to do
// there once already signed in — bounce straight to the dashboard instead.
function RedirectIfAuthed({ children }) {
  const { isAuthenticated, checking } = useAuth();
  if (checking) return <FullScreenLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public landing page — this is what a first-time visitor sees,
          before any login prompt. */}
      <Route path="/" element={<HomePage />} />

      <Route
        path="/login"
        element={(
          <RedirectIfAuthed>
            <AuthPage />
          </RedirectIfAuthed>
        )}
      />

      <Route
        path="/dashboard"
        element={(
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        )}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
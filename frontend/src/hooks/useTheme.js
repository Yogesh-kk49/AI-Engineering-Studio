import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'ai-engineer-studio-theme';

/**
 * Reads/writes the `data-theme` attribute on <html> so every CSS variable
 * in index.css swaps automatically. Persists the choice in localStorage
 * and falls back to the OS-level light/dark preference on first run.
 */
export default function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
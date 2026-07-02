import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

// Backend never sends a status literally called "Pending" — it moves through
// these stages instead. Anything not in this terminal set is still running.
const TERMINAL_STATUSES = ['Completed', 'Failed'];
export const isAnalysisInProgress = (a) => !TERMINAL_STATUSES.includes(a.status);

export function useAnalyses() {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const pollRef = useRef(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await api.get('analysis/');
      const results = res.data.results || [];
      setAnalyses(results);
      setError(null);
      return results;
    } catch {
      setError('Cannot connect to backend on port 8000. Is the server running?');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const results = await fetchAll();
      if (!results.some(isAnalysisInProgress)) stopPolling();
    }, 3000);
  }, [fetchAll, stopPolling]);

  const refresh = useCallback(async () => {
    const results = await fetchAll();
    if (results.some(isAnalysisInProgress)) startPolling();
  }, [fetchAll, startPolling]);

  useEffect(() => {
    refresh();
    return stopPolling;
  }, []);

  const deleteAnalysis = useCallback(async (id) => {
    try {
      await api.delete(`analysis/${id}/`);
      setAnalyses(prev => prev.filter(a => a.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { analyses, loading, error, refresh, deleteAnalysis };
}
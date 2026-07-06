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
  // Interval callbacks close over whatever `analyses` was when the interval
  // was *created*, not its latest value. Keep a ref in sync so each tick
  // knows the current set of in-progress ids without needing to recreate
  // the interval (and without pulling `analyses` into the poll's own
  // dependency array, which would re-fetch on every single status change).
  const analysesRef = useRef([]);
  useEffect(() => { analysesRef.current = analyses; }, [analyses]);

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

  // This used to call fetchAll() (the full list — every analysis ever run,
  // full report metadata blob and all, easily multiple MB) every 3 seconds
  // for as long as anything was in progress. That's the same mistake the
  // Analyze button's own polling had: reading one row's status doesn't
  // need megabytes of data most of that fetch throws away.
  //
  // Now: poll only GET /api/analysis/<id>/progress/ (a few hundred bytes)
  // for each currently in-progress row. When a row's progress response
  // reports it just went terminal (Completed/Failed), pull that *one*
  // row's full detail (still far cheaper than the whole list) so its
  // final metadata shows up, then stop tracking it. The full list is only
  // ever re-fetched on initial load, after a delete, or via an explicit
  // refresh() call — not on a timer.
  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const inProgress = analysesRef.current.filter(isAnalysisInProgress);
      if (inProgress.length === 0) { stopPolling(); return; }

      const updates = await Promise.all(inProgress.map(async (row) => {
        try {
          const res = await api.get(`analysis/${row.id}/progress/`);
          return { id: row.id, progress: res.data };
        } catch {
          return null; // transient — leave that row as-is, retry next tick
        }
      }));

      const justFinished = updates.filter(u => u && TERMINAL_STATUSES.includes(u.progress.status));

      // Cheap merge: patch status/percent/message onto matching rows.
      setAnalyses(prev => prev.map(row => {
        const u = updates.find(x => x && x.id === row.id);
        if (!u) return row;
        return { ...row, status: u.progress.status, progress_percent: u.progress.progress_percent,
                 progress_message: u.progress.progress_message };
      }));

      // Only for rows that just completed/failed: fetch that one row's
      // full detail so its final report/metadata actually shows up.
      await Promise.all(justFinished.map(async (u) => {
        try {
          const res = await api.get(`analysis/${u.id}/`);
          setAnalyses(prev => prev.map(row => row.id === u.id ? res.data : row));
        } catch {
          // If this fails, the row still has correct status from the merge
          // above — just missing the full report until the next refresh().
        }
      }));

      const stillInProgress = analysesRef.current.some(isAnalysisInProgress);
      if (!stillInProgress) stopPolling();
    }, 3000);
  }, [stopPolling]);

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

  // The list endpoint now sends a trimmed `metadata` (just what a
  // collapsed card's header needs) instead of every analysis's full
  // report — see the matching comment in RepositoryAnalysisListView.
  // AnalysisCard calls this once it's fetched its own full detail
  // (GET /api/analysis/<id>/) the first time it's expanded, so that
  // row's tabs get the complete data without every *other* row having
  // paid for it too.
  const patchAnalysis = useCallback((id, fullData) => {
    setAnalyses(prev => prev.map(row => row.id === id ? fullData : row));
  }, []);

  return { analyses, loading, error, refresh, deleteAnalysis, patchAnalysis };
}
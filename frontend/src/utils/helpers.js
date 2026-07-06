export const GRADE_COLORS = {
  A: { bg: 'var(--grade-a-bg)', color: 'var(--grade-a)' },
  B: { bg: 'var(--grade-b-bg)', color: 'var(--grade-b)' },
  C: { bg: 'var(--grade-c-bg)', color: 'var(--grade-c)' },
  D: { bg: 'var(--grade-d-bg)', color: 'var(--grade-d)' },
  F: { bg: 'var(--grade-f-bg)', color: 'var(--grade-f)' },
};

export const gradeColor = (grade) =>
  GRADE_COLORS[grade] || { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' };

// Meaningful text instead of a bare letter — a fresh user landing on "D" or
// "F" has no context for what that means at a glance.
export const GRADE_LABELS = {
  A: 'Excellent',
  B: 'Good',
  C: 'Fair',
  D: 'Needs Improvement',
  F: 'Critical',
};

export const gradeLabel = (grade) => GRADE_LABELS[grade] || null;

export const scoreColor = (score) => {
  if (score >= 90) return 'var(--grade-a)';
  if (score >= 75) return 'var(--grade-b)';
  if (score >= 60) return 'var(--grade-c)';
  if (score >= 45) return 'var(--grade-d)';
  return 'var(--grade-f)';
};

export const dash = (val) =>
  val == null || val === '' ? '—' : val;

export const list = (arr) =>
  Array.isArray(arr) && arr.length ? arr.join(', ') : '—';

export const formatNumber = (n) => {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

// Human-readable byte size for showing "how much has downloaded so far"
// when the server doesn't send a Content-Length (so a percentage of total
// isn't knowable) — the same thing a browser's own download manager shows
// for a stream of unknown length, rather than leaving the number blank.
export const formatBytes = (bytes) => {
  if (bytes == null || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i += 1;
  }
  const decimals = i === 0 ? 0 : val >= 10 ? 1 : 2;
  return `${val.toFixed(decimals)} ${units[i]}`;
};

export const timeAgo = (dateStr) => {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
};

export const scoreGrade = (score) => {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  return 'F';
};

// Normalizes a GitHub URL so equivalent links match each other regardless of
// protocol, "www.", trailing ".git", trailing slash, or casing —
// https://github.com/foo/Bar.git and github.com/foo/bar/ are "the same repo".
export const normalizeRepoUrl = (url) => {
  if (!url) return '';
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
};
import React from 'react';

const LANG_COLORS = {
  Python: '#3572A5', JavaScript: '#f1e05a', TypeScript: '#2b7489',
  Java: '#b07219', Go: '#00ADD8', Rust: '#dea584', 'C++': '#f34b7d',
  Ruby: '#701516', PHP: '#4F5D95', Swift: '#ffac45', Kotlin: '#A97BFF',
  HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', C: '#555',
};
const FALLBACK = ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#6366f1'];

export function LanguageBar({ languages }) {
  if (!languages || typeof languages !== 'object') return null;
  const entries = Object.entries(languages);
  if (!entries.length) return null;

  const total = entries.reduce((s, [, v]) => s + (typeof v === 'number' ? v : 1), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Stacked bar */}
      <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', gap: 1 }}>
        {entries.map(([lang, val], i) => {
          const pct   = total ? ((typeof val === 'number' ? val : 1) / total) * 100 : 100 / entries.length;
          const color = LANG_COLORS[lang] || FALLBACK[i % FALLBACK.length];
          return (
            <div key={lang} style={{ width: `${pct}%`, background: color, minWidth: pct > 5 ? 4 : 0 }}
                 title={`${lang}: ${pct.toFixed(1)}%`} />
          );
        })}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        {entries.slice(0, 8).map(([lang, val], i) => {
          const pct   = total ? ((typeof val === 'number' ? val : 1) / total) * 100 : 100 / entries.length;
          const color = LANG_COLORS[lang] || FALLBACK[i % FALLBACK.length];
          return (
            <div key={lang} style={{ display: 'flex', alignItems: 'center', gap: 5,
                                     fontSize: 11, color: 'var(--text)' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span>{lang}</span>
              <span style={{ color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
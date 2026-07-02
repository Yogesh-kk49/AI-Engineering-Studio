import React from 'react';
import { LanguageBar } from '../ui/Charts';
import { Tag } from '../ui/Badge';
import { dash, formatNumber, timeAgo } from '../../utils/helpers';

function StatCard({ label, value, icon }) {
  return (
    <div style={{ background: '#f8f9fb', border: '1px solid var(--border)',
                  borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-strong)',
                        lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4,
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        </div>
        {icon && <span style={{ fontSize: 20, opacity: 0.5 }}>{icon}</span>}
      </div>
    </div>
  );
}

function FeatureFlag({ label, value }) {
  const ok = !!value;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                  borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: ok ? 'var(--grade-a-bg)' : 'var(--grade-f-bg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700,
                       color: ok ? 'var(--grade-a)' : 'var(--grade-f)' }}>
          {ok ? '✓' : '✗'}
        </span>
      </div>
      <span style={{ fontSize: 13, color: ok ? 'var(--text-strong)' : 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  );
}

export default function OverviewTab({ analysis }) {
  const m     = analysis.metadata || {};
  const langs = typeof m.languages === 'object' && !Array.isArray(m.languages) ? m.languages : {};
  const langArr = Array.isArray(m.languages) ? m.languages : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Creator / owner */}
      {(m.owner_login || m.creator) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                      background: '#f8f9fb', border: '1px solid var(--border)',
                      borderRadius: 10, padding: '12px 16px' }}>
          {m.owner_avatar_url ? (
            <img src={m.owner_avatar_url} alt={m.owner_login || m.creator}
                 style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                          background: 'rgba(79,126,248,0.12)', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
              {(m.owner_login || m.creator || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase',
                          letterSpacing: '0.06em', marginBottom: 2 }}>
              Creator
            </div>
            {m.owner_html_url ? (
              <a href={m.owner_html_url} target="_blank" rel="noreferrer"
                 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>
                {m.owner_login || m.creator}
              </a>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)' }}>
                {m.owner_login || m.creator}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12 }}>
        <StatCard label="Stars"        value={formatNumber(m.stars)}             icon="⭐" />
        <StatCard label="Forks"        value={formatNumber(m.forks)}             icon="🍴" />
        <StatCard label="Open Issues"  value={formatNumber(m.open_issues)}       icon="🐛" />
        <StatCard label="Contributors" value={formatNumber(m.contributors)}      icon="👥" />
        <StatCard label="Files"        value={formatNumber(analysis.file_count)} icon="📄" />
        <StatCard label="Folders"      value={formatNumber(analysis.folder_count)} icon="📁" />
      </div>

      {/* Language bar */}
      {Object.keys(langs).length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Language Distribution
          </div>
          <LanguageBar languages={langs} />
        </div>
      )}
      {langArr.length > 0 && Object.keys(langs).length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {langArr.map(l => <Tag key={l}>{l}</Tag>)}
        </div>
      )}

      {/* Topics */}
      {m.topics?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Topics
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {m.topics.map(t => <Tag key={t} color="var(--accent)">{t}</Tag>)}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Repo metadata */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Repository Info
          </div>
          {[
            ['Primary Language', dash(m.primary_language)],
            ['License',          dash(m.license_name)],
            ['Last Updated',     timeAgo(m.updated_at)],
            ['Created',          m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'],
            ['Analysis Time',    m.duration_seconds ? `${m.duration_seconds}s` : '—'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                                      padding: '7px 0', borderBottom: '1px solid var(--border)',
                                      fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span style={{ color: 'var(--text-strong)', fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Feature flags */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Project Features
          </div>
          <FeatureFlag label="README"           value={analysis.has_readme} />
          <FeatureFlag label="Docker"           value={analysis.has_docker} />
          <FeatureFlag label="Docker Compose"   value={m.docker_compose} />
          <FeatureFlag label="requirements.txt" value={analysis.has_requirements} />
          <FeatureFlag label="package.json"     value={analysis.has_package_json} />
          <FeatureFlag label="GitHub Actions"   value={m.github_actions} />
          <FeatureFlag label="License File"     value={m.license} />
        </div>
      </div>
    </div>
  );
}
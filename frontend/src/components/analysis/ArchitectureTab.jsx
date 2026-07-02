import React from 'react';
import { Tag } from '../ui/Badge';

function Group({ title, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map(item => {
          const name = typeof item === 'string' ? item : item.name || item;
          const conf = typeof item === 'object' ? item.confidence : null;
          return (
            <Tag key={name} color="var(--accent)">
              {name}{conf != null ? ` (${conf}%)` : ''}
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

function LayerDiagram() {
  const layers = [
    { label: 'Client / Browser', color: '#8b5cf6' },
    { label: 'API / Gateway',    color: '#06b6d4' },
    { label: 'Services',         color: '#10b981' },
    { label: 'Data Store',       color: '#f59e0b' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0' }}>
      {layers.map((layer, i) => (
        <React.Fragment key={layer.label}>
          <div style={{ width: 220, padding: '10px 16px', textAlign: 'center',
                        background: `${layer.color}15`, border: `1px solid ${layer.color}40`,
                        borderRadius: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: layer.color }}>{layer.label}</span>
          </div>
          {i < layers.length - 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 24 }}>
              <div style={{ width: 1, flex: 1, background: 'var(--border)' }} />
              <div style={{ width: 0, height: 0,
                borderLeft: '4px solid transparent', borderRight: '4px solid transparent',
                borderTop: '5px solid var(--text-muted)' }} />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function ArchitectureTab({ architecture }) {
  if (!architecture) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
      Architecture data not available
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Detected patterns */}
      {architecture.architecture_patterns?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Detected Patterns
          </div>
          {architecture.architecture_patterns.map((p, i) => {
            // Backend sends {pattern, confidence, evidence} — `name`/`title`
            // are checked too in case an older/alternate shape shows up.
            const name = typeof p === 'string' ? p : (p.pattern || p.name || p.title || 'Pattern');
            const conf = typeof p === 'object' ? p.confidence : null;
            const evidence = typeof p === 'object' ? p.evidence : null;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2,
                padding: '10px 14px', marginBottom: 6,
                background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)',
                borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-strong)', fontSize: 13 }}>{name}</span>
                  {conf != null && (
                    <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, flexShrink: 0 }}>
                      {conf}% confidence
                    </span>
                  )}
                </div>
                {evidence && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{evidence}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <Group title="Backend Frameworks"  items={architecture.backend} />
          <Group title="Frontend Frameworks" items={architecture.frontend} />
          <Group title="Databases"           items={architecture.databases} />
          <Group title="Authentication"      items={architecture.authentication} />
          <Group title="API Types"           items={architecture.api_types} />
        </div>
        <div>
          <LayerDiagram />
          <Group title="Caching"        items={architecture.caching} />
          <Group title="CI/CD"          items={architecture.cicd} />
          <Group title="Infrastructure" items={architecture.infrastructure} />
          <Group title="Observability"  items={architecture.observability} />
        </div>
      </div>

      {architecture.recommendations?.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Recommendations
          </div>
          {architecture.recommendations.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '9px 14px', marginBottom: 6,
              background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.12)',
              borderRadius: 8, fontSize: 13 }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>→</span>
              <span style={{ color: 'var(--text)' }}>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
import React from 'react';

export function Skeleton({ width = '100%', height = 16, radius = 6, style }) {
  return (
    <div className="skeleton" style={{ width, height, borderRadius: radius, ...style }} />
  );
}

export function SkeletonCard() {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: 24,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Skeleton width={160} height={18} />
        <Skeleton width={70}  height={22} radius={20} />
      </div>
      <Skeleton width={220} height={12} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Skeleton width={60} height={22} radius={4} />
        <Skeleton width={80} height={22} radius={4} />
        <Skeleton width={50} height={22} radius={4} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {[1,2,3,4].map(i => <Skeleton key={i} height={48} />)}
      </div>
    </div>
  );
}
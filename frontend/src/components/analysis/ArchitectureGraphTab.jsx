import React, { useState } from 'react';
import CodeViewerModal from './CodeViewerModal';

// Lightweight extension → icon/color map so the tree reads at a glance
// without pulling in an icon library.
const EXT_STYLE = {
  js:   { icon: '🟨', color: '#eab308' },
  jsx:  { icon: '🟦', color: '#3b82f6' },
  ts:   { icon: '🔷', color: '#2563eb' },
  tsx:  { icon: '🔷', color: '#2563eb' },
  py:   { icon: '🐍', color: '#3776ab' },
  json: { icon: '🟫', color: '#a16207' },
  md:   { icon: '📄', color: '#6b7280' },
  css:  { icon: '🎨', color: '#ec4899' },
  scss: { icon: '🎨', color: '#ec4899' },
  html: { icon: '🌐', color: '#f97316' },
  yml:  { icon: '⚙️', color: '#6b7280' },
  yaml: { icon: '⚙️', color: '#6b7280' },
  env:  { icon: '🔑', color: '#ef4444' },
  sql:  { icon: '🗄️', color: '#0ea5e9' },
  sh:   { icon: '💻', color: '#16a34a' },
};
const DEFAULT_FILE_STYLE = { icon: '📄', color: 'var(--text-muted)' };

// Directories with more than this many children show a paginated
// "+N more" button instead of rendering everything at once — mostly a DOM
// size safeguard for huge repos, since the backend now sends the full tree.
const PAGE_SIZE = 30;

function styleFor(node) {
  if (node.type === 'dir')  return { icon: '📁', color: '#f59e0b' };
  const ext = node.name.includes('.') ? node.name.split('.').pop().toLowerCase() : '';
  return EXT_STYLE[ext] || DEFAULT_FILE_STYLE;
}

// A single node in the tree. Directories are collapsible; files are
// clickable and open the code viewer. The connecting vertical/horizontal
// guide lines are what give this the "flowchart" feel without needing a
// graph-layout library.
function TreeNode({ node, depth, defaultOpen, filePath, onOpenFile }) {
  const isDir = node.type === 'dir';
  const hasChildren = isDir && node.children && node.children.length > 0;
  const [open, setOpen] = useState(defaultOpen);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { icon, color } = styleFor(node);

  const handleClick = () => {
    if (isDir) {
      if (hasChildren) setOpen(o => !o);
    } else {
      onOpenFile(filePath);
    }
  };

  const children = node.children || [];
  const visibleChildren = children.slice(0, visibleCount);
  const remaining = children.length - visibleChildren.length;

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={handleClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 8px', borderRadius: 6,
          cursor: (hasChildren || !isDir) ? 'pointer' : 'default',
          fontSize: 13, color: 'var(--text)',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#eef1f6'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ width: 12, display: 'inline-flex', justifyContent: 'center',
                       fontSize: 9, color: 'var(--text-muted)',
                       transform: open ? 'rotate(90deg)' : 'none',
                       transition: 'transform 0.15s', flexShrink: 0 }}>
          {hasChildren ? '▶' : ''}
        </span>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
        <span style={{
          fontFamily: isDir ? 'inherit' : 'var(--mono)',
          fontWeight: isDir ? 600 : 400,
          color: isDir ? 'var(--text-strong)' : color,
          whiteSpace: 'nowrap',
        }}>
          {node.name}{isDir ? '/' : ''}
        </span>
        {!isDir && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            (click to view code)
          </span>
        )}
        {node.truncated && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            (deeper levels collapsed)
          </span>
        )}
      </div>

      {hasChildren && open && (
        <div style={{ marginLeft: 15, paddingLeft: 11, borderLeft: '1.5px dashed var(--border)' }}>
          {visibleChildren.map((child, i) => (
            <TreeNode
              key={`${depth}-${i}-${child.name}`}
              node={child}
              depth={depth + 1}
              defaultOpen={depth + 1 < 1}
              filePath={filePath ? `${filePath}/${child.name}` : child.name}
              onOpenFile={onOpenFile}
            />
          ))}
          {remaining > 0 && (
            <button
              onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                       marginTop: 2, background: 'none', border: '1px solid var(--border)',
                       borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                       color: 'var(--accent)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(79,126,248,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >
              ⋯ +{remaining} more — click to show
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ArchitectureGraphTab({ fileTree, analysisId }) {
  const [openFile, setOpenFile] = useState(null);
  const [visibleRootCount, setVisibleRootCount] = useState(PAGE_SIZE);

  if (!fileTree || !fileTree.children || fileTree.children.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
        Project structure data isn't available for this analysis.
        <div style={{ fontSize: 12, marginTop: 6 }}>
          Re-run the analysis to generate the project structure map.
        </div>
      </div>
    );
  }

  const rootChildren = fileTree.children;
  const visibleRootChildren = rootChildren.slice(0, visibleRootCount);
  const rootRemaining = rootChildren.length - visibleRootChildren.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Project Structure
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Click a folder to expand or collapse it, or click a file to view its code.
          Large folders show a "show more" button instead of everything at once.
        </div>
      </div>

      <div style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: '16px 12px', overflowX: 'auto' }}>
        {/* Root node */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7,
                      padding: '5px 8px', fontWeight: 700, fontSize: 14,
                      color: 'var(--text-heading)', marginBottom: 4 }}>
          <span>🗂️</span>
          <span>{fileTree.name}/</span>
        </div>
        <div style={{ marginLeft: 15, paddingLeft: 11, borderLeft: '1.5px dashed var(--border)' }}>
          {visibleRootChildren.map((child, i) => (
            <TreeNode
              key={`root-${i}-${child.name}`}
              node={child}
              depth={1}
              defaultOpen={false}
              filePath={child.name}
              onOpenFile={setOpenFile}
            />
          ))}
          {rootRemaining > 0 && (
            <button
              onClick={() => setVisibleRootCount(c => c + PAGE_SIZE)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                       marginTop: 2, background: 'none', border: '1px solid var(--border)',
                       borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                       color: 'var(--accent)' }}
            >
              ⋯ +{rootRemaining} more — click to show
            </button>
          )}
        </div>
      </div>

      {openFile && (
        <CodeViewerModal analysisId={analysisId} path={openFile} onClose={() => setOpenFile(null)} />
      )}
    </div>
  );
}
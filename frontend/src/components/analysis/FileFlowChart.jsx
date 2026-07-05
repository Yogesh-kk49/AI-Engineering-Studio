import React, { useMemo, useState, useRef } from 'react';
import CodeViewerModal from './CodeViewerModal';

// Box-and-arrow flowchart of the repo's folder/file structure — distinct
// from the collapsible indented tree in "Project Structure". Limited to a
// shallow depth and a capped number of siblings per box by default (a full
// org-chart render of a real repo's file count would be unreadable), but
// any "+N more" box can be clicked to reveal its hidden siblings in place,
// and any file box can be clicked to view its source.
const BOX_W = 152;
const BOX_H = 44;
const X_GAP = 22;
const Y_GAP = 86;
const MAX_DEPTH = 3;     // root + 2 levels of folders/files
const MAX_CHILDREN = 6;  // per node, kept small so boxes don't overlap

const COLORS = {
  dir:  { fill: '#fff7ed', stroke: '#f59e0b', text: '#92400e' },
  file: { fill: '#eff6ff', stroke: '#3b82f6', text: '#1e40af' },
  more: { fill: '#f3f4f6', stroke: '#9ca3af', text: '#6b7280' },
};

// Caps siblings per directory (unless the directory's path is in
// `expandedPaths`, in which case all of them are kept) and assigns each
// node a stable repo-relative `path` so file boxes know what to fetch and
// "more" boxes know what to expand.
function prepareTree(node, path, depth, expandedPaths) {
  if (!node) return node;
  const isDir = node.type === 'dir';
  const realChildren = (node.children || []).filter(c => c.type !== 'more');

  if (!isDir || depth >= MAX_DEPTH || realChildren.length === 0) {
    return { name: node.name, type: node.type, path };
  }

  const expanded = expandedPaths.has(path);
  const kept = expanded ? realChildren : realChildren.slice(0, MAX_CHILDREN);
  const overflow = realChildren.length - kept.length;

  const children = kept.map(c => {
    const childPath = path ? `${path}/${c.name}` : c.name;
    return prepareTree(c, childPath, depth + 1, expandedPaths);
  });

  if (overflow > 0) {
    children.push({ name: `+${overflow} more`, type: 'more', path, overflowCount: overflow });
  }

  return { name: node.name, type: node.type, path, children };
}

function subtreeWidth(node) {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
}

// Recursively assigns x/y pixel positions to every node and records the
// parent -> child connector lines, returning a flat list of both.
function layout(root) {
  const boxes = [];
  const edges = [];
  let maxDepth = 0;

  function place(node, depth, xStart) {
    maxDepth = Math.max(maxDepth, depth);
    const w = subtreeWidth(node);
    const totalW = w * (BOX_W + X_GAP) - X_GAP;
    const xCenter = xStart + totalW / 2;
    const y = depth * Y_GAP;
    boxes.push({ node, x: xCenter, y, depth });

    if (node.children && node.children.length) {
      let cursor = xStart;
      for (const child of node.children) {
        const cw = subtreeWidth(child);
        const childTotalW = cw * (BOX_W + X_GAP) - X_GAP;
        place(child, depth + 1, cursor);
        const childCenter = cursor + childTotalW / 2;
        edges.push({
          x1: xCenter, y1: y + BOX_H,
          x2: childCenter, y2: (depth + 1) * Y_GAP,
        });
        cursor += childTotalW + X_GAP;
      }
    }
  }

  place(root, 0, 0);
  const totalWidth = subtreeWidth(root) * (BOX_W + X_GAP) - X_GAP;
  const totalHeight = maxDepth * Y_GAP + BOX_H;
  return { boxes, edges, totalWidth, totalHeight };
}

function iconFor(type) {
  if (type === 'dir')  return '📁';
  if (type === 'more') return '⋯';
  return '📄';
}

export default function FileFlowChart({ fileTree, analysisId }) {
  const [rootChoice, setRootChoice] = useState(-1); // -1 = whole repo, else index into top-level folders
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [openFile, setOpenFile] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef(null);
  const dragStateRef = useRef({ dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const toggleFullscreen = () => {
    setZoom(1);
    setIsFullscreen(f => !f);
  };

  const zoomIn  = () => setZoom(z => Math.min(2.5, +(z + 0.2).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(0.3, +(z - 0.2).toFixed(2)));
  const zoomReset = () => setZoom(1);

  // Click-and-drag panning, fullscreen only — grabs the scroll container
  // itself rather than moving the SVG, so it stays in sync with the
  // browser's native scrollbars/trackpad scrolling for free.
  const handleMouseDown = (e) => {
    if (!isFullscreen) return;
    // Left mouse button only, and not on an interactive box/button —
    // those still need a normal click to fire (open file, expand "more").
    if (e.button !== 0 || e.target.closest('button, select')) return;
    const el = scrollRef.current;
    if (!el) return;
    dragStateRef.current = {
      dragging: true, startX: e.clientX, startY: e.clientY,
      scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
    };
    setIsDragging(true);
  };

  React.useEffect(() => {
    const onMouseMove = (e) => {
      const ds = dragStateRef.current;
      if (!ds.dragging) return;
      const el = scrollRef.current;
      if (!el) return;
      el.scrollLeft = ds.scrollLeft - (e.clientX - ds.startX);
      el.scrollTop = ds.scrollTop - (e.clientY - ds.startY);
    };
    const onMouseUp = () => {
      if (dragStateRef.current.dragging) {
        dragStateRef.current.dragging = false;
        setIsDragging(false);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Esc closes fullscreen mode, same as any modal/overlay in the app.
  React.useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  const topDirs = useMemo(
    () => (fileTree?.children || []).filter(c => c.type === 'dir'),
    [fileTree]
  );

  // Repo-relative path prefix for whatever we're rendering as the root box.
  // Whole-repo view: the root box is just a label, not a real path segment.
  // Subfolder view: the chosen folder IS a real path segment.
  const rootPathPrefix = rootChoice === -1 ? '' : (topDirs[rootChoice]?.name || '');

  const displayRoot = useMemo(() => {
    if (!fileTree) return null;
    const source = rootChoice === -1 ? fileTree : (topDirs[rootChoice] || fileTree);
    return prepareTree(source, rootPathPrefix, 0, expandedPaths);
  }, [fileTree, rootChoice, topDirs, expandedPaths, rootPathPrefix]);

  const { boxes, edges, totalWidth, totalHeight } = useMemo(
    () => displayRoot ? layout(displayRoot) : { boxes: [], edges: [], totalWidth: 0, totalHeight: 0 },
    [displayRoot]
  );

  if (!fileTree || !fileTree.children || fileTree.children.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
        Project structure data isn't available for this analysis.
        <div style={{ fontSize: 12, marginTop: 6 }}>
          Re-run the analysis to generate the file flow chart.
        </div>
      </div>
    );
  }

  const handleBoxClick = (node) => {
    if (node.type === 'more') {
      setExpandedPaths(prev => new Set(prev).add(node.path));
    } else if (node.type === 'file') {
      setOpenFile(node.path);
    }
  };

  const PAD = 20;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            File Flow Chart
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 480 }}>
            A box-and-arrow view of how paths branch from a starting folder. Click a
            "⋯ +N more" box to reveal hidden siblings, or a file box to view its code.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {topDirs.length > 0 && (
            <select
              value={rootChoice}
              onChange={e => { setRootChoice(Number(e.target.value)); setExpandedPaths(new Set()); }}
              style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8,
                       border: '1px solid var(--border)', background: 'var(--bg-input)',
                       color: 'var(--text-strong)', flexShrink: 0 }}
            >
              <option value={-1}>Whole repository</option>
              {topDirs.map((d, i) => (
                <option key={d.name} value={i}>{d.name}/</option>
              ))}
            </select>
          )}

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit full screen' : 'View full screen'}
            style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-input)',
                     border: '1px solid var(--border)', color: 'var(--text-muted)',
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     cursor: 'pointer', flexShrink: 0, transition: 'var(--transition)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onMouseDown={handleMouseDown}
        style={{
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 16, overflow: 'auto',
          cursor: isFullscreen ? (isDragging ? 'grabbing' : 'grab') : 'default',
          userSelect: isDragging ? 'none' : 'auto',
          ...(isFullscreen ? {
            position: 'fixed', inset: 16, zIndex: 1000, boxShadow: 'var(--shadow-elevated)',
          } : { overflowX: 'auto' }),
        }}
      >
        {isFullscreen && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        marginBottom: 12, position: 'sticky', top: 0, background: 'var(--bg-subtle)', zIndex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>
              File Flow Chart
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)',
                            borderRadius: 8, overflow: 'hidden', background: 'var(--bg-input)' }}>
                <button
                  onClick={zoomOut}
                  title="Zoom out"
                  style={{ width: 30, height: 30, background: 'none', border: 'none',
                           color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  −
                </button>
                <button
                  onClick={zoomReset}
                  title="Reset zoom"
                  style={{ minWidth: 46, height: 30, background: 'none', border: 'none',
                           borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
                           color: 'var(--text-strong)', cursor: 'pointer', fontSize: 11.5, fontWeight: 600 }}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  onClick={zoomIn}
                  title="Zoom in"
                  style={{ width: 30, height: 30, background: 'none', border: 'none',
                           color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  +
                </button>
              </div>

              <button
                onClick={() => setIsFullscreen(false)}
                title="Close full screen (Esc)"
                style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-input)',
                         border: '1px solid var(--border)', color: 'var(--text-muted)',
                         display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--grade-f)'; e.currentTarget.style.color = 'var(--grade-f)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <svg
          width={(totalWidth + PAD * 2) * (isFullscreen ? zoom : 1)}
          height={(totalHeight + PAD * 2) * (isFullscreen ? zoom : 1)}
          viewBox={`${-PAD} ${-PAD} ${totalWidth + PAD * 2} ${totalHeight + PAD * 2}`}
          style={{ display: 'block',
                   minWidth: isFullscreen ? undefined : Math.min(totalWidth + PAD * 2, 1400) }}
        >
          {/* Connector lines, drawn first so boxes sit on top */}
          {edges.map((e, i) => {
            const midY = (e.y1 + e.y2) / 2;
            const path = `M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`;
            return (
              <path key={i} d={path} fill="none" stroke="#c9ccd3" strokeWidth="1.5" />
            );
          })}

          {/* Boxes */}
          {boxes.map((b, i) => {
            const c = COLORS[b.node.type] || COLORS.file;
            const label = b.node.name + (b.node.type === 'dir' ? '/' : '');
            const truncatedLabel = label.length > 20 ? label.slice(0, 18) + '…' : label;
            const clickable = b.node.type === 'more' || b.node.type === 'file';
            return (
              <g
                key={i}
                transform={`translate(${b.x - BOX_W / 2}, ${b.y})`}
                onClick={() => clickable && handleBoxClick(b.node)}
                style={{ cursor: clickable ? 'pointer' : 'default' }}
              >
                <rect
                  width={BOX_W} height={BOX_H} rx={8}
                  fill={c.fill} stroke={c.stroke} strokeWidth="1.5"
                />
                <text
                  x={BOX_W / 2} y={BOX_H / 2 - 3}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="11" fontWeight="600" fill={c.text}
                  fontFamily={b.node.type === 'file' ? 'var(--mono)' : 'inherit'}
                >
                  {iconFor(b.node.type)} {truncatedLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {isFullscreen && (
        <div
          onClick={() => setIsFullscreen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,0.55)', zIndex: 999 }}
        />
      )}

      {openFile && (
        <CodeViewerModal analysisId={analysisId} path={openFile} onClose={() => setOpenFile(null)} />
      )}
    </div>
  );
}
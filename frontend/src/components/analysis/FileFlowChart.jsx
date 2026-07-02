import React, { useMemo, useState } from 'react';
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
      </div>

      <div style={{ background: '#f8f9fb', border: '1px solid var(--border)',
                    borderRadius: 12, padding: 16, overflowX: 'auto' }}>
        <svg
          width={totalWidth + PAD * 2}
          height={totalHeight + PAD * 2}
          viewBox={`${-PAD} ${-PAD} ${totalWidth + PAD * 2} ${totalHeight + PAD * 2}`}
          style={{ display: 'block', minWidth: Math.min(totalWidth + PAD * 2, 1400) }}
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

      {openFile && (
        <CodeViewerModal analysisId={analysisId} path={openFile} onClose={() => setOpenFile(null)} />
      )}
    </div>
  );
}

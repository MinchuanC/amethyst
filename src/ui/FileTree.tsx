import { ChevronRight, FilePlus, FolderPlus, ChevronsDownUp } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { confirmDelete, copyLinkTo, createNote, duplicateNote, promptNewFolder, promptRename, renameTracked, reportError } from '../actions';
import { api, type FileEntry } from '../api';
import { NOTE_DRAG_TYPE } from '../dnd';
import { useGraphInfo } from '../state/graphInfo';
import { useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { useContextMenu, type MenuItem } from './ContextMenu';
import { IconButton } from './primitives';

interface TreeNode {
  name: string;
  path: string;
  kind: FileEntry['kind'];
  children: TreeNode[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] };
  const folders = new Map<string, TreeNode>([['', root]]);
  const ensure = (path: string): TreeNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const node: TreeNode = { name: path.split('/').pop()!, path, kind: 'folder', children: [] };
    ensure(parentPath).children.push(node);
    folders.set(path, node);
    return node;
  };
  for (const f of files) if (f.kind === 'folder') ensure(f.path);
  for (const f of files) {
    if (f.kind === 'folder') continue;
    const parentPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    ensure(parentPath).children.push({ name: f.path.split('/').pop()!, path: f.path, kind: f.kind, children: [] });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.kind === 'folder') !== (b.kind === 'folder') ? (a.kind === 'folder' ? -1 : 1) : collator.compare(a.name, b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

export function FileTree() {
  const files = useVault((s) => s.files);
  const active = useWorkspace((s) => s.active);
  const tree = useMemo(() => buildTree(files), [files]);
  const noteCount = useMemo(() => files.filter((f) => f.kind === 'note').length, [files]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const showMenu = useContextMenu((s) => s.show);

  useEffect(() => {
    if (!active) return;
    setOpen((prev) => {
      const next = new Set(prev);
      let dir = active.includes('/') ? active.slice(0, active.lastIndexOf('/')) : '';
      let changed = false;
      while (dir) {
        if (!next.has(dir)) {
          next.add(dir);
          changed = true;
        }
        dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
      }
      return changed ? next : prev;
    });
  }, [active]);

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const menuFor = (node: TreeNode | null, x: number, y: number) => {
    const items: MenuItem[] = [];
    if (!node || node.kind === 'folder') {
      const folder = node?.path ?? '';
      items.push({ label: 'New note here', onSelect: () => createNote(folder) });
      items.push({ label: 'New folder here', onSelect: () => promptNewFolder(folder) });
      if (node) {
        items.push({ label: 'Rename folder…', onSelect: () => promptRename(node.path, true), separatorBefore: true });
        if (api.isNative) items.push({ label: 'Reveal in Finder', onSelect: () => api.revealInFinder(node.path) });
        items.push({ label: 'Move folder to trash', danger: true, onSelect: () => confirmDelete(node.path, true) });
      }
    } else {
      items.push({ label: 'Open in new tab', onSelect: () => useWorkspace.getState().openNote(node.path, { newTab: true }) });
      if (node.kind === 'note') {
        items.push({ label: 'Rename…', onSelect: () => promptRename(node.path) });
        items.push({ label: 'Make a copy', onSelect: () => duplicateNote(node.path) });
        items.push({ label: 'Copy link to note', onSelect: () => copyLinkTo(node.path) });
      } else if (api.isNative) {
        items.push({ label: 'Open in its default app', onSelect: () => api.openInDefaultApp(node.path).catch(reportError) });
      }
      if (api.isNative) items.push({ label: 'Reveal in Finder', onSelect: () => api.revealInFinder(node.path) });
      items.push({ label: 'Move to trash', danger: true, separatorBefore: true, onSelect: () => confirmDelete(node.path) });
    }
    showMenu(x, y, items);
  };

  return (
    <div className="file-tree">
      <div className="pane-head">
        <span className="pane-meta num">
          {noteCount} note{noteCount === 1 ? '' : 's'}
        </span>
        <div className="pane-actions">
          <IconButton label="New note" onClick={() => createNote()}>
            <FilePlus size={14} />
          </IconButton>
          <IconButton label="New folder" onClick={() => promptNewFolder()}>
            <FolderPlus size={14} />
          </IconButton>
          <IconButton label="Collapse all folders" onClick={() => setOpen(new Set())}>
            <ChevronsDownUp size={14} />
          </IconButton>
        </div>
      </div>
      <div
        className={`tree-scroll ${dropTarget === '' ? 'is-drop-root' : ''}`}
        role="tree"
        aria-label="Vault files"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            menuFor(null, e.clientX, e.clientY);
          }
        }}
        onKeyDown={(e) => {
          const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.tree-row')];
          const i = rows.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return;
          const row = rows[i];
          const isFolder = row.getAttribute('aria-expanded') != null;
          const expanded = row.getAttribute('aria-expanded') === 'true';
          if (e.key === 'ArrowDown') rows[Math.min(rows.length - 1, i + 1)].focus();
          else if (e.key === 'ArrowUp') rows[Math.max(0, i - 1)].focus();
          else if (e.key === 'Home') rows[0].focus();
          else if (e.key === 'End') rows[rows.length - 1].focus();
          else if (e.key === 'ArrowRight' && isFolder && !expanded) row.click();
          else if (e.key === 'ArrowRight' && isFolder) rows[i + 1]?.focus();
          else if (e.key === 'ArrowLeft' && isFolder && expanded) row.click();
          else if (e.key === 'ArrowLeft') {
            const depth = parseFloat(row.style.paddingLeft);
            for (let j = i - 1; j >= 0; j--) {
              if (parseFloat(rows[j].style.paddingLeft) < depth) {
                rows[j].focus();
                break;
              }
            }
          } else return;
          e.preventDefault();
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setDropTarget('');
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDropTarget(null);
        }}
        onDrop={(e) => {
          const src = e.dataTransfer.getData(NOTE_DRAG_TYPE);
          setDropTarget(null);
          if (!src || e.target !== e.currentTarget) return;
          e.preventDefault();
          moveInto(src, '');
        }}
      >
        {tree.map((n) => (
          <Row
            key={n.path}
            node={n}
            depth={0}
            open={open}
            active={active}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            onDropInto={(src, folder) => {
              moveInto(src, folder);
              setOpen((prev) => new Set(prev).add(folder));
            }}
            toggle={toggle}
            onMenu={menuFor}
          />
        ))}
        {tree.length === 0 && <p className="pane-empty">This vault is empty. Create a note to start.</p>}
      </div>
    </div>
  );
}

/** Moves a dragged file or folder into `folder` ('' is the vault root), keeping links intact. */
async function moveInto(src: string, folder: string) {
  const name = src.split('/').pop()!;
  const dest = folder ? `${folder}/${name}` : name;
  if (dest === src || folder === src || folder.startsWith(`${src}/`)) return;
  try {
    await renameTracked(src, dest);
    useWorkspace.getState().toast(`Moved to ${folder || 'the vault root'}.`);
  } catch (e) {
    reportError(e);
  }
}

interface RowProps {
  node: TreeNode;
  depth: number;
  open: Set<string>;
  active: string | null;
  dropTarget: string | null;
  setDropTarget: (path: string | null) => void;
  onDropInto: (src: string, folder: string) => void;
  toggle: (path: string) => void;
  onMenu: (node: TreeNode, x: number, y: number) => void;
}

const Row = memo(function Row(props: RowProps) {
  const { node, depth, open, active, dropTarget, setDropTarget, onDropInto, toggle, onMenu } = props;
  const color = useGraphInfo((s) => (node.kind === 'note' ? s.colors.get(node.path) : undefined));
  const isOpen = open.has(node.path);
  const isFolder = node.kind === 'folder';
  const label = node.kind === 'note' ? node.name.replace(/\.md$/i, '') : node.name;
  const onClick = (e: React.MouseEvent) => {
    if (isFolder) toggle(node.path);
    else useWorkspace.getState().openNote(node.path, { newTab: e.metaKey });
  };
  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
        aria-selected={node.path === active}
        className={`tree-row kind-${node.kind} ${node.path === active ? 'is-active' : ''} ${dropTarget === node.path ? 'is-drop' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(NOTE_DRAG_TYPE, node.path);
          e.dataTransfer.setData('text/plain', node.kind === 'note' ? `[[${label}]]` : node.name);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onDragEnd={() => setDropTarget(null)}
        onDragOver={(e) => {
          if (!isFolder || !e.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          if (dropTarget !== node.path) setDropTarget(node.path);
        }}
        onDrop={(e) => {
          if (!isFolder) return;
          const src = e.dataTransfer.getData(NOTE_DRAG_TYPE);
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(null);
          if (src) onDropInto(src, node.path);
        }}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(node, e.clientX, e.clientY);
        }}
      >
        {isFolder ? (
          <ChevronRight size={12} className={`tree-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden />
        ) : (
          <span className="tree-dot" style={color ? ({ '--dot': color } as React.CSSProperties) : undefined} aria-hidden />
        )}
        <span className="tree-name">{label}</span>
      </button>
      {isFolder && isOpen && node.children.map((c) => <Row key={c.path} {...props} node={c} depth={depth + 1} />)}
    </>
  );
});

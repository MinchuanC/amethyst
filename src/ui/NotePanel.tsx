import { BookOpen, ChevronLeft, ChevronRight, Crosshair, ExternalLink, FolderSearch, MoreHorizontal, PenLine, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { confirmDelete, copyLinkTo, createNote, duplicateNote, noteFolder, promptRename, renameTracked, reportError } from '../actions';
import { api } from '../api';
import { bus } from '../bus';
import { Editor } from '../editor/Editor';
import { ReadingView } from '../editor/ReadingView';
import { NOTE_DRAG_TYPE } from '../dnd';
import { useEditorStats } from '../state/editorStats';
import { useGraphInfo } from '../state/graphInfo';
import { graphModel, useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { useContextMenu } from './ContextMenu';
import { folderOf, formatDate, IconButton, Kbd, titleOf } from './primitives';

export function NotePanel() {
  const tabs = useWorkspace((s) => s.tabs);
  const active = useWorkspace((s) => s.active);
  const viewMode = useWorkspace((s) => (s.active ? s.viewModes[s.active] ?? 'edit' : 'edit'));
  const ws = useWorkspace.getState();
  const showMenu = useContextMenu((s) => s.show);
  const [dragging, setDragging] = useState<string | null>(null);

  const tabMenu = (t: string, x: number, y: number) => {
    const index = tabs.indexOf(t);
    showMenu(x, y, [
      { label: 'Close', onSelect: () => ws.closeTab(t) },
      { label: 'Close other tabs', onSelect: () => ws.setTabs([t], t) },
      {
        label: 'Close tabs to the right',
        onSelect: () => {
          const kept = tabs.slice(0, index + 1);
          ws.setTabs(kept, active && kept.includes(active) ? active : t);
        },
      },
      { label: 'Close all tabs', onSelect: () => ws.setTabs([], null) },
      ...(/\.md$/i.test(t)
        ? [
            { label: 'Copy link to note', separatorBefore: true, onSelect: () => copyLinkTo(t) },
            ...(api.isNative ? [{ label: 'Reveal in Finder', onSelect: () => api.revealInFinder(t) }] : []),
          ]
        : []),
    ]);
  };

  return (
    <section className="panel note-panel" aria-label="Note">
      <div className="tabbar" role="tablist" aria-label="Open notes">
        {tabs.map((t) => (
          <div
            key={t}
            className={`tab ${t === active ? 'is-active' : ''} ${dragging === t ? 'is-dragging' : ''}`}
            role="presentation"
            draggable
            onDragStart={(e) => {
              setDragging(t);
              e.dataTransfer.setData(NOTE_DRAG_TYPE, t);
              e.dataTransfer.effectAllowed = 'copyMove';
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => {
              if (!dragging || dragging === t) return;
              e.preventDefault();
              ws.moveTab(dragging, tabs.indexOf(t));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              tabMenu(t, e.clientX, e.clientY);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={t === active}
              className="tab-label"
              title={t}
              onClick={() => ws.setActive(t)}
              onAuxClick={(e) => e.button === 1 && ws.closeTab(t)}
            >
              {titleOf(t)}
            </button>
            <button type="button" className="tab-close" aria-label={`Close ${titleOf(t)}`} onClick={() => ws.closeTab(t)}>
              <X size={12} />
            </button>
          </div>
        ))}
        <IconButton label="New note" className="tab-new" onClick={() => createNote(noteFolder(active))}>
          <Plus size={14} />
        </IconButton>
      </div>
      {active ? (
        /\.md$/i.test(active) ? (
          <NoteView key="note" path={active} mode={viewMode} />
        ) : (
          <AttachmentView path={active} />
        )
      ) : (
        <EmptyNote />
      )}
    </section>
  );
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

function formatBytes(n: number) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentView({ path }: { path: string }) {
  const version = useVault((s) => s.graphVersion);
  const name = path.split('/').pop()!;
  const folder = folderOf(path);
  const facts = useMemo(() => {
    const node = graphModel.nodes.get(path);
    let refs = 0;
    for (const e of graphModel.edges.values()) if (e.target === path) refs++;
    return { size: node?.size ?? 0, modified: node?.modified ?? 0, refs };
  }, [path, version]);
  const url = api.assetUrl(path);

  return (
    <div className="note-view">
      <header className="note-head">
        <div className="note-crumbs">
          {folder ? folder.split('/').map((p, i) => <span key={i}>{p}</span>) : <span>Vault root</span>}
        </div>
        <h1 className="note-title attachment-title">{name}</h1>
        <div className="note-meta">
          <span>{formatBytes(facts.size)}</span>
          {facts.modified > 0 && <span>Changed {formatDate(facts.modified)}</span>}
          <span>
            Embedded in {facts.refs} note{facts.refs === 1 ? '' : 's'}
          </span>
        </div>
        {api.isNative && (
          <div className="note-tools">
            <IconButton label="Open in its default app" onClick={() => api.openInDefaultApp(path).catch(reportError)}>
              <ExternalLink size={15} />
            </IconButton>
            <IconButton label="Reveal in Finder" onClick={() => api.revealInFinder(path).catch(reportError)}>
              <FolderSearch size={15} />
            </IconButton>
          </div>
        )}
      </header>
      <div className="attachment-body">
        {IMAGE_RE.test(path) && url ? (
          <img src={url} alt={name} />
        ) : (
          <div className="attachment-fallback">
            <p>Amethyst can’t show this kind of file inside a note.</p>
            {api.isNative && (
              <button type="button" className="button" onClick={() => api.openInDefaultApp(path).catch(reportError)}>
                <ExternalLink size={14} aria-hidden /> Open in its default app
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteView({ path, mode }: { path: string; mode: 'edit' | 'read' }) {
  const ws = useWorkspace.getState();
  const canBack = useWorkspace((s) => s.historyIndex > 0);
  const canForward = useWorkspace((s) => s.historyIndex < s.history.length - 1);
  const showMenu = useContextMenu((s) => s.show);
  const folder = folderOf(path);

  return (
    <div className="note-view">
      <header className="note-head">
        <div className="note-crumbs">
          {folder ? folder.split('/').map((p, i) => <span key={i}>{p}</span>) : <span>Vault root</span>}
        </div>
        <TitleInput path={path} />
        <NoteMeta path={path} />
        <div className="note-tools">
          <IconButton label="Go back (⌘[)" disabled={!canBack} onClick={() => useWorkspace.getState().back()}>
            <ChevronLeft size={15} />
          </IconButton>
          <IconButton label="Go forward (⌘])" disabled={!canForward} onClick={() => useWorkspace.getState().forward()}>
            <ChevronRight size={15} />
          </IconButton>
          <IconButton
            label={mode === 'edit' ? 'Switch to reading view (⌘E)' : 'Switch to editing view (⌘E)'}
            onClick={() => ws.toggleViewMode(path)}
          >
            {mode === 'edit' ? <BookOpen size={15} /> : <PenLine size={15} />}
          </IconButton>
          <IconButton
            label="Focus this note in the graph"
            onClick={() => {
              ws.setMode('graph');
              ws.setFocus(path);
            }}
          >
            <Crosshair size={15} />
          </IconButton>
          <IconButton
            label="More actions"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              showMenu(r.right - 200, r.bottom + 6, [
                { label: 'Rename…', onSelect: () => promptRename(path) },
                { label: 'Open in new tab', onSelect: () => ws.openNote(path, { newTab: true }) },
                { label: 'Make a copy', onSelect: () => duplicateNote(path) },
                { label: 'Copy link to note', onSelect: () => copyLinkTo(path) },
                ...(api.isNative ? [{ label: 'Reveal in Finder', onSelect: () => api.revealInFinder(path) }] : []),
                { label: 'Move to trash', danger: true, separatorBefore: true, onSelect: () => confirmDelete(path) },
              ]);
            }}
          >
            <MoreHorizontal size={15} />
          </IconButton>
        </div>
      </header>
      <div className="note-body">{mode === 'edit' ? <Editor path={path} /> : <ReadingView path={path} />}</div>
    </div>
  );
}

const BAD_CHARS = /[[\]#^|\\:*?"<>]/;

function TitleInput({ path }: { path: string }) {
  const [value, setValue] = useState(titleOf(path));
  const ref = useRef<HTMLInputElement>(null);
  const titleFocus = useWorkspace((s) => s.titleFocus);
  useEffect(() => setValue(titleOf(path)), [path]);
  useEffect(() => {
    if (titleFocus !== path) return;
    useWorkspace.getState().setTitleFocus(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
  }, [titleFocus, path]);

  const commit = async () => {
    const next = value.trim();
    if (!next || next === titleOf(path)) {
      setValue(titleOf(path));
      return;
    }
    if (BAD_CHARS.test(next)) {
      useWorkspace.getState().toast('Titles can’t contain [ ] # ^ | \\ : * ? " < >', 'error');
      setValue(titleOf(path));
      return;
    }
    const folder = folderOf(path);
    try {
      const result = await renameTracked(path, `${folder ? `${folder}/` : ''}${next}.md`);
      if (result.updatedLinks) {
        useWorkspace.getState().toast(`Renamed. Updated ${result.updatedLinks} link${result.updatedLinks === 1 ? '' : 's'}.`);
      }
    } catch (e) {
      reportError(e);
      setValue(titleOf(path));
    }
  };

  return (
    <input
      ref={ref}
      className="note-title"
      value={value}
      aria-label="Note title"
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          bus.emit('editor:focus');
        }
        if (e.key === 'Escape') {
          setValue(titleOf(path));
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function NoteMeta({ path }: { path: string }) {
  const graphVersion = useVault((s) => s.graphVersion);
  const cluster = useGraphInfo((s) => {
    const idx = s.clusters.get(path);
    return idx != null && idx >= 0 ? s.clusterList[idx] : undefined;
  });
  const meta = useMemo(() => {
    const node = graphModel.nodes.get(path);
    let out = 0;
    let back = 0;
    for (const e of graphModel.edges.values()) {
      if (e.source === path) out++;
      if (e.target === path) back++;
    }
    return { created: node?.created ?? 0, out, back };
  }, [path, graphVersion]);
  const words = useEditorStats((s) => (s.path === path ? s.words : null));

  return (
    <div className="note-meta">
      <span>Created {formatDate(meta.created)}</span>
      {words != null && (
        <span>
          {words.toLocaleString()} word{words === 1 ? '' : 's'}
        </span>
      )}
      <span>
        {meta.out} link{meta.out === 1 ? '' : 's'} out
      </span>
      <span>
        {meta.back} backlink{meta.back === 1 ? '' : 's'}
      </span>
      {cluster && (
        <span className="note-cluster">
          <i style={{ background: cluster.color }} aria-hidden />
          {cluster.label}
        </span>
      )}
    </div>
  );
}

function EmptyNote() {
  return (
    <div className="note-empty">
      <p className="note-empty-title">No note open</p>
      <p>Pick a note from the sidebar, or press <Kbd>⌘O</Kbd> to find one.</p>
      <button type="button" className="button" onClick={() => createNote()}>
        <Plus size={14} /> New note
      </button>
    </div>
  );
}

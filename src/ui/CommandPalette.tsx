import { CornerDownLeft, FilePlus, Search, Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createNote } from '../actions';
import { commands, titleOf as commandTitle, type Command } from '../commands';
import { useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { rank } from './fuzzy';
import { folderOf, Highlighted, Kbd } from './primitives';
import { play } from './sounds';
import { useFocusTrap } from './useFocusTrap';

interface NoteItem {
  path: string;
  label: string;
  alias?: string;
}

type Row =
  | { kind: 'command'; cmd: Command; title: string; indices: number[] }
  | { kind: 'note'; note: NoteItem; indices: number[] }
  | { kind: 'create'; name: string };

export function CommandPalette({ mode }: { mode: 'palette' | 'switcher' }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const linkTargets = useVault((s) => s.linkTargets);
  const tabs = useWorkspace((s) => s.tabs);
  const close = () => useWorkspace.getState().setOverlay(null);

  useEffect(() => play('whoosh'), []);

  const rows: Row[] = useMemo(() => {
    if (mode === 'palette') {
      const available = commands.filter((c) => !c.available || c.available()).map((c) => ({ c, title: commandTitle(c) }));
      return rank(available, query, (x) => x.title, 80).map(({ item, indices }) => ({ kind: 'command', cmd: item.c, title: item.title, indices }));
    }
    const notes: NoteItem[] = [];
    for (const t of linkTargets) {
      if (!/\.md$/i.test(t.path)) continue;
      notes.push({ path: t.path, label: t.title });
      for (const a of t.aliases) notes.push({ path: t.path, label: a, alias: t.title });
    }
    if (!query.trim()) {
      const recent = tabs.map((p) => notes.find((n) => n.path === p && !n.alias)).filter((n): n is NoteItem => !!n);
      const rest = notes.filter((n) => !n.alias && !tabs.includes(n.path)).sort((a, b) => a.label.localeCompare(b.label));
      return [...recent, ...rest].slice(0, 60).map((note) => ({ kind: 'note', note, indices: [] }));
    }
    const ranked: Row[] = rank(notes, query, (n) => n.label, 60).map(({ item, indices }) => ({ kind: 'note', note: item, indices }));
    const exact = notes.some((n) => n.label.toLowerCase() === query.trim().toLowerCase());
    if (!exact) ranked.push({ kind: 'create', name: query.trim() });
    return ranked;
  }, [mode, query, linkTargets, tabs]);

  useEffect(() => setIndex(0), [query, mode]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (row: Row | undefined, newTab = false) => {
    if (!row) return;
    close();
    play('select');
    if (row.kind === 'command') setTimeout(() => row.cmd.run(), 0);
    else if (row.kind === 'note') useWorkspace.getState().openNote(row.note.path, { newTab });
    else createNote('', row.name.replace(/[[\]#^|\\:*?"<>]/g, ''));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey && mode === 'switcher' && query.trim()) choose({ kind: 'create', name: query.trim() });
      else choose(rows[index], e.metaKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="overlay-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialogRef} className="palette" role="dialog" aria-modal="true" aria-label={mode === 'palette' ? 'Command palette' : 'Open note'}>
        <label className="palette-input">
          {mode === 'palette' ? <Terminal size={16} aria-hidden /> : <Search size={16} aria-hidden />}
          <input
            autoFocus
            value={query}
            placeholder={mode === 'palette' ? 'Type a command' : 'Find a note, or type a new title'}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={`palette-row-${index}`}
          />
        </label>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {rows.map((row, i) => (
            <div
              key={i}
              id={`palette-row-${i}`}
              role="option"
              aria-selected={i === index}
              className={`palette-row ${i === index ? 'is-active' : ''}`}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={(e) => choose(row, e.metaKey)}
            >
              {row.kind === 'command' && (
                <>
                  <span className="palette-section">{row.cmd.section}</span>
                  <span className="palette-title">
                    <Highlighted text={row.title} indices={row.indices} />
                  </span>
                  {row.cmd.shortcut && <Kbd>{row.cmd.shortcut}</Kbd>}
                </>
              )}
              {row.kind === 'note' && (
                <>
                  <span className="palette-title">
                    <Highlighted text={row.note.label} indices={row.indices} />
                    {row.note.alias && <span className="palette-alias"> → {row.note.alias}</span>}
                  </span>
                  <span className="palette-folder">{folderOf(row.note.path) || 'Vault root'}</span>
                </>
              )}
              {row.kind === 'create' && (
                <>
                  <FilePlus size={14} aria-hidden />
                  <span className="palette-title">
                    Create “{row.name}”
                  </span>
                  <Kbd>⇧↵</Kbd>
                </>
              )}
            </div>
          ))}
          {rows.length === 0 && <p className="palette-empty">Nothing matches “{query}”.</p>}
        </div>
        <footer className="palette-foot">
          <span>
            <CornerDownLeft size={12} aria-hidden /> {mode === 'palette' ? 'Run' : 'Open'}
          </span>
          {mode === 'switcher' && <span>⌘↵ Open in a new tab</span>}
          <span>Esc to close</span>
        </footer>
      </div>
    </div>
  );
}

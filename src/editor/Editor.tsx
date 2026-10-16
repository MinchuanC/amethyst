import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap, placeholder } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { followLink, openExternal, reportError } from '../actions';
import { api } from '../api';
import { runCommand } from '../commands';
import { bus } from '../bus';
import { NOTE_DRAG_TYPE } from '../dnd';
import { useSettings } from '../state/settings';
import { graphModel, onVaultChange, useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { useEditorStats } from '../state/editorStats';
import { rectOf, usePreview } from '../state/preview';
import { vaultCompletions } from './completion';
import { formattingKeymap } from './formatting';
import { flushEditor, registerFlush, takeRename } from './bridge';
import { frontmatter } from './frontmatter';
import { livePreview, markdownLinkAt } from './livePreview';
import { amethystEditorTheme } from './theme';
import { refreshLinks, wikilinks } from './wikilinks';

const SAVE_DELAY = 550;

/** Editor states per note, so undo history survives tab switches. */
const stateCache = new Map<string, EditorState>();

/** Paths deleted or moved away; a late save must never recreate them. */
const removedPaths = new Set<string>();

/** Writes run one after another so an older save can never land last. */
let writeQueue: Promise<void> = Promise.resolve();

export { flushEditor };

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const EXT_FOR_TYPE: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/** Saves pasted or dropped files into the vault and inserts embeds for them. */
async function insertFiles(view: EditorView, files: File[], pos: number, near: string | null) {
  const links: string[] = [];
  for (const file of files) {
    const generic = !file.name || /^image\.(png|jpe?g|gif|webp)$/i.test(file.name);
    const name = generic ? `Pasted image ${stamp()}.${EXT_FOR_TYPE[file.type] ?? 'png'}` : file.name;
    const saved = await api.saveAttachment(name, new Uint8Array(await file.arrayBuffer()), near ?? undefined);
    links.push(`![[${saved.split('/').pop()}]]`);
  }
  if (!links.length) return;
  const insert = links.join('\n');
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: 'input.paste' });
}

const spellcheckAttrs = (on: boolean) =>
  EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false', autocorrect: on ? 'on' : 'off', autocapitalize: 'off' });

function resolvedSet() {
  const set = new Set<string>();
  for (const t of useVault.getState().linkTargets) {
    set.add(t.title.toLowerCase());
    set.add(t.path.toLowerCase());
    set.add(t.path.toLowerCase().replace(/\.md$/, ''));
    for (const a of t.aliases) set.add(a.toLowerCase());
  }
  return set;
}

function allTags() {
  const tags = new Set<string>();
  for (const n of graphModel.nodes.values()) for (const t of n.tags) tags.add(t);
  return [...tags].sort();
}

function assetFor(target: string) {
  const lower = target.toLowerCase().replace(/^(\.\.?\/)+/, '').replace(/^\//, '');
  const hit = useVault.getState().linkTargets.find((t) => t.path.toLowerCase() === lower || t.path.toLowerCase().endsWith(`/${lower}`));
  return hit ? api.assetUrl(hit.path) || null : null;
}

export function Editor({ path }: { path: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const pathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const extensionsRef = useRef<Extension[] | null>(null);
  const lpCompartment = useRef(new Compartment());
  const spellCompartment = useRef(new Compartment());
  const statsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resolvedRef = useRef<Set<string>>(resolvedSet());

  const save = (p: string | null, text: string) => {
    clearTimeout(timerRef.current);
    if (!p || !dirtyRef.current || removedPaths.has(p)) return writeQueue;
    dirtyRef.current = false;
    writeQueue = writeQueue.then(() =>
      api.writeNote(p, text).catch((e) => {
        if (pathRef.current === p) dirtyRef.current = true;
        reportError(e);
      }),
    );
    return writeQueue;
  };

  const reportStats = (text: string, immediate = false) => {
    clearTimeout(statsTimer.current);
    const p = pathRef.current;
    if (!p) return;
    if (immediate) useEditorStats.getState().set(p, text);
    else statsTimer.current = setTimeout(() => useEditorStats.getState().set(p, text), 250);
  };

  if (!extensionsRef.current) {
    extensionsRef.current = [
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage, addKeymap: true, extensions: [frontmatter] }),
      placeholder('Start writing. Type [[ to link another note.'),
      Prec.highest(
        keymap.of([
          { key: 'Mod-g', run: () => (runCommand('mode.toggle'), true) },
          { key: 'Mod-Shift-g', run: () => true },
          { key: 'Mod-e', run: () => (runCommand('note.reading'), true) },
          { key: 'Mod-[', run: () => (runCommand('nav.back'), true) },
          { key: 'Mod-]', run: () => (runCommand('nav.forward'), true) },
          ...formattingKeymap,
        ]),
      ),
      spellCompartment.current.of(spellcheckAttrs(useSettings.getState().spellcheck)),
      keymap.of([...closeBracketsKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap, indentWithTab]),
      vaultCompletions({ targets: () => useVault.getState().linkTargets, tags: allTags }),
      wikilinks({
        onFollow: (target, newTab) => pathRef.current && followLink(target, pathRef.current, newTab),
        isResolved: (target) => resolvedRef.current.has(target.toLowerCase()),
        plainClickFollows: (view, pos) => {
          if (!useSettings.getState().livePreview) return false;
          if (!view.hasFocus) return true;
          const line = view.state.doc.lineAt(pos).number;
          return !view.state.selection.ranges.some(
            (r) => view.state.doc.lineAt(r.from).number <= line && view.state.doc.lineAt(r.to).number >= line,
          );
        },
      }),
      EditorView.domEventHandlers({
        mouseover(e) {
          const link = (e.target as HTMLElement).closest('.cm-wikilink:not(.cm-wikilink-unresolved)') as HTMLElement | null;
          const target = link?.dataset.target;
          if (!link || !target || !e.metaKey || !pathRef.current) return false;
          const from = pathRef.current;
          api.resolveLink(target, from).then((resolved) => {
            if (resolved && resolved !== from) usePreview.getState().show(resolved, rectOf(link));
          });
          return false;
        },
        mouseout(e) {
          if ((e.target as HTMLElement).closest('.cm-wikilink')) usePreview.getState().scheduleHide();
          return false;
        },
        paste(e, view) {
          const files = [...(e.clipboardData?.files ?? [])];
          if (!files.length) return false;
          e.preventDefault();
          insertFiles(view, files, view.state.selection.main.from, pathRef.current).catch(reportError);
          return true;
        },
        dragover(e) {
          if (e.dataTransfer?.types.includes(NOTE_DRAG_TYPE) || e.dataTransfer?.types.includes('Files')) {
            e.preventDefault();
            return false;
          }
          return false;
        },
        drop(e, view) {
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
          const dragged = e.dataTransfer?.getData(NOTE_DRAG_TYPE);
          if (dragged) {
            e.preventDefault();
            const name = dragged.split('/').pop()!;
            const insert = /\.md$/i.test(name) ? `[[${name.replace(/\.md$/i, '')}]]` : `![[${name}]]`;
            view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: 'input.drop' });
            view.focus();
            return true;
          }
          const files = [...(e.dataTransfer?.files ?? [])];
          if (!files.length) return false;
          e.preventDefault();
          insertFiles(view, files, pos, pathRef.current).catch(reportError);
          return true;
        },
        mousedown(e, view) {
          if (e.button !== 0 || !useSettings.getState().livePreview) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos).number;
          const onActive = view.hasFocus && view.state.selection.ranges.some((r) => view.state.doc.lineAt(r.head).number === line);
          if (onActive && !e.metaKey) return false;
          const url = markdownLinkAt(view.state, pos);
          if (!url) return false;
          e.preventDefault();
          if (/^[a-z][a-z0-9+.-]*:/i.test(url)) openExternal(url);
          else if (pathRef.current) followLink(decodeURIComponent(url.split('#')[0]), pathRef.current, e.metaKey && e.altKey);
          return true;
        },
      }),
      lpCompartment.current.of(useSettings.getState().livePreview ? livePreview({ assetFor }) : []),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        dirtyRef.current = true;
        clearTimeout(timerRef.current);
        const p = pathRef.current;
        timerRef.current = setTimeout(() => save(p, u.view.state.doc.toString()), SAVE_DELAY);
        reportStats(u.state.doc.toString());
      }),
      amethystEditorTheme,
    ];
  }

  const freshState = (doc: string) => EditorState.create({ doc, extensions: extensionsRef.current! });

  useEffect(() => {
    const view = new EditorView({ state: freshState(''), parent: hostRef.current! });
    viewRef.current = view;
    const flush = () => save(pathRef.current, view.state.doc.toString());
    registerFlush(flush);
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
    const offFocus = bus.on('editor:focus', () => view.focus());
    const offVault = useVault.subscribe((s, prev) => {
      if (s.info?.root === prev.info?.root) return;
      stateCache.clear();
      removedPaths.clear();
    });
    return () => {
      flush();
      registerFlush(null);
      offVault();
      if (pathRef.current) stateCache.set(pathRef.current, view.state);
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', flush);
      offFocus();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current!;
    const prev = pathRef.current;
    if (prev && prev !== path && takeRename(prev) === path) {
      // Same note, new name: keep the document, cursor and undo history.
      pathRef.current = path;
      removedPaths.delete(path);
      reportStats(view.state.doc.toString(), true);
      return;
    }
    if (prev && prev !== path) {
      save(prev, view.state.doc.toString());
      if (!removedPaths.has(prev)) stateCache.set(prev, view.state);
    }
    pathRef.current = path;
    removedPaths.delete(path);
    let cancelled = false;
    const afterLoad = () => {
      const { livePreview: lp, spellcheck } = useSettings.getState();
      view.dispatch({
        effects: [
          lpCompartment.current.reconfigure(lp ? livePreview({ assetFor }) : []),
          spellCompartment.current.reconfigure(spellcheckAttrs(spellcheck)),
        ],
      });
      reportStats(view.state.doc.toString(), true);
      const pending = useWorkspace.getState().pendingLine;
      if (pending && pending.path === path) {
        const line = view.state.doc.line(Math.min(view.state.doc.lines, pending.line + 1));
        view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
        useWorkspace.getState().consumePendingLine();
        view.focus();
      }
    };
    const cached = stateCache.get(path);
    if (cached) {
      view.setState(cached);
      afterLoad();
    } else {
      view.setState(freshState(''));
      api
        .readNote(path)
        .then((text) => {
          if (cancelled || pathRef.current !== path) return;
          view.setState(freshState(text));
          afterLoad();
        })
        .catch(reportError);
    }
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(
    () =>
      onVaultChange((change) => {
        const touched = new Set([...change.changed, ...change.added]);
        for (const p of change.removed) {
          stateCache.delete(p);
          removedPaths.add(p);
        }
        for (const p of change.added) removedPaths.delete(p);
        for (const p of touched) {
          if (p !== pathRef.current) {
            stateCache.delete(p);
            continue;
          }
          if (dirtyRef.current) continue;
          api.readNote(p).then((text) => {
            const view = viewRef.current;
            if (!view || pathRef.current !== p || dirtyRef.current) return;
            const current = view.state.doc.toString();
            if (text === current) return;
            const head = Math.min(view.state.selection.main.head, text.length);
            view.dispatch({ changes: { from: 0, to: current.length, insert: text }, selection: { anchor: head }, userEvent: 'external' });
            dirtyRef.current = false;
            clearTimeout(timerRef.current);
          });
        }
      }),
    [],
  );

  useEffect(
    () =>
      useVault.subscribe((s, prev) => {
        if (s.linkTargets !== prev.linkTargets) {
          resolvedRef.current = resolvedSet();
          viewRef.current?.dispatch({ effects: refreshLinks.of(null) });
        }
      }),
    [],
  );

  useEffect(
    () =>
      useSettings.subscribe((s, prev) => {
        if (s.livePreview !== prev.livePreview) {
          viewRef.current?.dispatch({ effects: lpCompartment.current.reconfigure(s.livePreview ? livePreview({ assetFor }) : []) });
        }
        if (s.spellcheck !== prev.spellcheck) {
          viewRef.current?.dispatch({ effects: spellCompartment.current.reconfigure(spellcheckAttrs(s.spellcheck)) });
        }
      }),
    [],
  );

  useEffect(
    () =>
      useWorkspace.subscribe((s, prev) => {
        const pending = s.pendingLine;
        if (!pending || pending === prev.pendingLine || pending.path !== pathRef.current) return;
        const view = viewRef.current;
        if (!view || view.state.doc.length === 0) return;
        const line = view.state.doc.line(Math.min(view.state.doc.lines, pending.line + 1));
        view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
        useWorkspace.getState().consumePendingLine();
        view.focus();
      }),
    [],
  );

  return <div className="editor-host" ref={hostRef} />;
}

export function forgetEditorState(path: string) {
  stateCache.delete(path);
}

import { generateVault } from '../dev/synthVault';
import { parseNote, type LiteParsed } from './mockParser';
import {
  UNRESOLVED_PREFIX,
  type Backend,
  type FileEntry,
  type GraphDelta,
  type GraphEdge,
  type GraphNode,
  type Mention,
  type SearchHit,
  type VaultChange,
  type VaultInfo,
} from './types';

interface MockFile {
  path: string;
  kind: 'note' | 'attachment';
  text: string;
  created: number;
  modified: number;
  parsed: LiteParsed;
  resolved: (string | null)[];
}

const isNote = (p: string) => /\.md$/i.test(p);
const titleOf = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '');
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const edgeId = (s: string, t: string) => `${s}\u001f${t}`;
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 0));

/**
 * In-memory backend so the UI runs in a plain browser. Loads the sample
 * vault, or a synthetic one with `?gen=5000`.
 */
export function createMockBackend(): Backend {
  const files = new Map<string, MockFile>();
  const folders = new Set<string>();
  let nodes = new Map<string, GraphNode>();
  let edges = new Map<string, GraphEdge>();
  const listeners = new Set<(c: VaultChange) => void>();
  const blobUrls = new Map<string, string>();
  let name = 'sample-vault';
  let opened = false;

  function addFile(path: string, text: string, created?: number) {
    const parsed = isNote(path) ? parseNote(text) : parseNote('');
    const now = Date.now();
    files.set(path, {
      path,
      kind: isNote(path) ? 'note' : 'attachment',
      text,
      created: created ?? parsed.created ?? now,
      modified: now,
      parsed,
      resolved: [],
    });
    let dir = parentOf(path);
    while (dir) {
      folders.add(dir);
      dir = parentOf(dir);
    }
  }

  function load() {
    files.clear();
    folders.clear();
    const gen = Number(new URLSearchParams(location.search).get('gen') ?? 0);
    if (gen > 0) {
      name = `synthetic-${gen}`;
      for (const n of generateVault(gen)) addFile(n.path, n.content);
    } else {
      const raw = import.meta.glob('/fixtures/sample-vault/**/*', {
        query: '?raw',
        import: 'default',
        eager: true,
      }) as Record<string, string>;
      for (const [key, text] of Object.entries(raw)) addFile(key.replace('/fixtures/sample-vault/', ''), text);
    }
    recompute();
    opened = true;
  }

  let exactMap = new Map<string, string>();
  let nameMap = new Map<string, string[]>();
  let aliasMap = new Map<string, string[]>();

  function buildMaps() {
    exactMap = new Map();
    nameMap = new Map();
    aliasMap = new Map();
    const push = (m: Map<string, string[]>, k: string, v: string) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);
    for (const f of files.values()) {
      const lower = f.path.toLowerCase();
      exactMap.set(lower, f.path);
      const name = lower.split('/').pop()!;
      push(nameMap, name, f.path);
      if (isNote(lower)) {
        if (!exactMap.has(lower.slice(0, -3))) exactMap.set(lower.slice(0, -3), f.path);
        push(nameMap, name.slice(0, -3), f.path);
      }
      for (const a of f.parsed.aliases) push(aliasMap, a.toLowerCase(), f.path);
    }
  }

  function resolve(target: string, from: string, markdown: boolean): string | null {
    const t = target.trim().replace(/^\//, '');
    const lower = t.toLowerCase();
    const fromDir = parentOf(from);
    const byPath = (p: string) => exactMap.get(p.toLowerCase()) ?? null;
    if (markdown || t.startsWith('./') || t.startsWith('../')) {
      const parts = fromDir ? fromDir.split('/') : [];
      for (const seg of t.split('/')) {
        if (seg === '..') parts.pop();
        else if (seg && seg !== '.') parts.push(seg);
      }
      const hit = byPath(parts.join('/'));
      if (hit) return hit;
    }
    const exact = byPath(t);
    if (exact) return exact;
    const pickBest = (cands: string[]) =>
      cands.find((c) => parentOf(c).toLowerCase() === fromDir.toLowerCase()) ??
      [...cands].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ??
      null;
    const byName = lower.includes('/')
      ? [...files.keys()].filter((p) => p.toLowerCase().endsWith(`/${lower}.md`) || p.toLowerCase().endsWith(`/${lower}`))
      : nameMap.get(lower) ?? [];
    if (byName.length) return pickBest(byName);
    const byAlias = aliasMap.get(lower) ?? [];
    return byAlias.length ? pickBest(byAlias) : null;
  }

  function recompute(): GraphDelta {
    buildMaps();
    const nextNodes = new Map<string, GraphNode>();
    const nextEdges = new Map<string, GraphEdge>();
    for (const f of files.values()) {
      nextNodes.set(f.path, {
        id: f.path,
        title: titleOf(f.path),
        kind: f.kind,
        folder: parentOf(f.path),
        tags: f.parsed.tags,
        created: f.created,
        modified: f.modified,
        size: f.text.length,
      });
    }
    for (const f of files.values()) {
      if (f.kind !== 'note') continue;
      f.resolved = f.parsed.links.map((l) => resolve(l.target, f.path, l.markdown));
      f.parsed.links.forEach((l, i) => {
        let target = f.resolved[i];
        if (!target) {
          target = UNRESOLVED_PREFIX + l.target.toLowerCase();
          const existing = nextNodes.get(target);
          if (existing) existing.created = Math.min(existing.created, f.created);
          else
            nextNodes.set(target, { id: target, title: l.target, kind: 'unresolved', folder: '', tags: [], created: f.created, modified: 0, size: 0 });
        }
        if (target === f.path) return;
        const id = edgeId(f.path, target);
        const e = nextEdges.get(id);
        if (e) e.count++;
        else nextEdges.set(id, { id, source: f.path, target, kind: l.embed ? 'embed' : 'link', count: 1 });
      });
    }
    const delta: GraphDelta = { upsertNodes: [], removeNodes: [], upsertEdges: [], removeEdges: [] };
    for (const [id, n] of nextNodes) if (JSON.stringify(nodes.get(id)) !== JSON.stringify(n)) delta.upsertNodes.push(n);
    for (const id of nodes.keys()) if (!nextNodes.has(id)) delta.removeNodes.push(id);
    for (const [id, e] of nextEdges) if (JSON.stringify(edges.get(id)) !== JSON.stringify(e)) delta.upsertEdges.push(e);
    for (const id of edges.keys()) if (!nextEdges.has(id)) delta.removeEdges.push(id);
    nodes = nextNodes;
    edges = nextEdges;
    return delta;
  }

  function emit(partial: Partial<VaultChange>) {
    const delta = recompute();
    const change: VaultChange = { origin: 'app', delta, added: [], removed: [], changed: [], foldersChanged: false, ...partial };
    setTimeout(() => listeners.forEach((l) => l(change)), 0);
  }

  const info = (): VaultInfo => ({
    root: `/mock/${name}`,
    name,
    noteCount: [...files.values()].filter((f) => f.kind === 'note').length,
    fileCount: files.size,
  });

  const tokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));

  return {
    isNative: false,
    pickVaultFolder: () => wait('/mock/sample-vault'),
    openVault: async () => {
      load();
      return info();
    },
    closeVault: async () => {
      opened = false;
    },
    currentVault: async () => (opened ? info() : null),
    listRecentVaults: async () => [{ path: '/mock/sample-vault', name: 'sample-vault', lastOpened: Date.now() }],
    removeRecentVault: async () => {},
    listFiles: async () => {
      const out: FileEntry[] = [...folders].map((p) => ({ path: p, kind: 'folder', modified: 0 }));
      for (const f of files.values()) out.push({ path: f.path, kind: f.kind, modified: f.modified });
      return out;
    },
    graphSnapshot: async () => ({ nodes: [...nodes.values()], edges: [...edges.values()] }),
    linkTargets: async () =>
      [...files.values()].map((f) => ({ path: f.path, title: titleOf(f.path), aliases: f.parsed.aliases, headings: f.parsed.headings.map((h) => h.text) })),
    readNote: async (path) => {
      const f = files.get(path);
      if (!f) throw new Error(`Not found: ${path}`);
      return f.text;
    },
    writeNote: async (path, contents) => {
      const prev = files.get(path);
      addFile(path, contents, prev?.created);
      emit({ changed: prev ? [path] : [], added: prev ? [] : [path] });
    },
    createNote: async (path, contents = '') => {
      let p = isNote(path) ? path : `${path}.md`;
      let i = 1;
      while (files.has(p)) p = `${path.replace(/\.md$/i, '')} ${i++}.md`;
      addFile(p, contents);
      emit({ added: [p], foldersChanged: true });
      return p;
    },
    createFolder: async (path) => {
      folders.add(path);
      emit({ foldersChanged: true });
      return path;
    },
    renamePath: async (from, to) => {
      const moves = new Map<string, string>();
      for (const p of files.keys()) {
        if (p === from) moves.set(p, isNote(to) || !isNote(from) ? to : `${to}.md`);
        else if (p.startsWith(`${from}/`)) moves.set(p, to + p.slice(from.length));
      }
      const updated: string[] = [];
      let links = 0;
      for (const [oldPath, newPath] of moves) {
        const f = files.get(oldPath)!;
        files.delete(oldPath);
        addFile(newPath, f.text, f.created);
        const oldTitle = titleOf(oldPath);
        const newTitle = titleOf(newPath);
        if (oldTitle === newTitle) continue;
        for (const other of files.values()) {
          const re = new RegExp(`\\[\\[${oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\]|#])`, 'g');
          const next = other.text.replace(re, () => {
            links++;
            return `[[${newTitle}`;
          });
          if (next !== other.text) {
            addFile(other.path, next, other.created);
            updated.push(other.path);
          }
        }
      }
      if (folders.has(from)) {
        folders.delete(from);
        folders.add(to);
      }
      emit({ added: [...moves.values()], removed: [...moves.keys()], changed: updated, foldersChanged: true });
      return { newPath: moves.get(from) ?? to, updatedFiles: updated, updatedLinks: links };
    },
    deletePath: async (path) => {
      const removed = [...files.keys()].filter((p) => p === path || p.startsWith(`${path}/`));
      removed.forEach((p) => files.delete(p));
      folders.delete(path);
      emit({ removed, foldersChanged: true });
    },
    resolveLink: async (target, from) => resolve(target, from, false),
    noteLinks: async (path) => {
      const key = path.startsWith(UNRESOLVED_PREFIX) ? path.slice(UNRESOLVED_PREFIX.length) : null;
      const backlinks = [];
      for (const f of files.values()) {
        if (f.path === path) continue;
        const snippets = f.parsed.links
          .filter((l, i) => (key ? !f.resolved[i] && l.target.toLowerCase() === key : f.resolved[i] === path))
          .map((l) => ({ line: l.line, text: f.text.split('\n')[l.line]?.trim() ?? '' }));
        if (snippets.length) backlinks.push({ source: f.path, title: titleOf(f.path), snippets });
      }
      const f = files.get(path);
      const seen = new Set<string>();
      const outgoing = (f?.parsed.links ?? [])
        .map((l, i) => {
          const r = f!.resolved[i];
          return { target: r ?? UNRESOLVED_PREFIX + l.target.toLowerCase(), title: r ? titleOf(r) : l.target, resolved: !!r, kind: l.embed ? ('embed' as const) : ('link' as const) };
        })
        .filter((o) => o.target !== path && !seen.has(o.target) && !!seen.add(o.target));
      return { backlinks, outgoing, headings: f?.parsed.headings ?? [] };
    },
    unlinkedMentions: async (path) => {
      const target = files.get(path);
      if (!target) return [];
      const names = [titleOf(path), ...target.parsed.aliases].filter((n) => n.length >= 3);
      const re = new RegExp(`\\b(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
      const out: Mention[] = [];
      for (const f of files.values()) {
        if (f.kind !== 'note' || f.path === path || f.resolved.includes(path)) continue;
        for (const m of f.text.matchAll(re)) {
          const at = m.index!;
          if (at < f.parsed.bodyStart || f.parsed.links.some((l) => at < l.end && at + m[0].length > l.start)) continue;
          const line = f.text.slice(0, at).split('\n').length - 1;
          out.push({ source: f.path, title: titleOf(f.path), line, text: f.text.split('\n')[line].trim(), offset: at, length: m[0].length });
        }
      }
      return out;
    },
    linkMention: async (source, offset, length, target) => {
      const f = files.get(source)!;
      const found = f.text.slice(offset, offset + length);
      const title = titleOf(target);
      const link = found === title ? `[[${title}]]` : `[[${title}|${found}]]`;
      addFile(source, f.text.slice(0, offset) + link + f.text.slice(offset + length), f.created);
      emit({ changed: [source] });
    },
    search: async (query, limit = 80) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      const hits: SearchHit[] = [];
      for (const f of files.values()) {
        if (f.kind !== 'note') continue;
        const lower = f.text.toLowerCase();
        const title = titleOf(f.path).toLowerCase();
        if (!terms.every((t) => lower.includes(t) || title.includes(t))) continue;
        const score = terms.reduce((s, t) => s + lower.split(t).length - 1 + (title.includes(t) ? 12 : 0), 0);
        const snippets = f.text
          .split('\n')
          .map((text, line) => ({ line, text: text.trim() }))
          .filter((s) => terms.some((t) => s.text.toLowerCase().includes(t)))
          .slice(0, 3);
        hits.push({ path: f.path, title: titleOf(f.path), score, snippets });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    },
    similarNotes: async (path, limit = 8) => {
      const base = files.get(path);
      if (!base) return [];
      const a = tokens(base.text);
      return [...files.values()]
        .filter((f) => f.kind === 'note' && f.path !== path)
        .map((f) => {
          const b = tokens(f.text);
          let inter = 0;
          for (const w of a) if (b.has(w)) inter++;
          return { path: f.path, title: titleOf(f.path), score: inter / Math.max(1, a.size + b.size - inter) };
        })
        .filter((s) => s.score > 0.05)
        .sort((x, y) => y.score - x.score)
        .slice(0, limit);
    },
    ghostLinks: async (threshold = 0.22) => {
      const notes = [...files.values()].filter((f) => f.kind === 'note').slice(0, 1500);
      const sets = notes.map((f) => tokens(f.text));
      const out = [];
      for (let i = 0; i < notes.length; i++) {
        let best = -1;
        let bestScore = 0;
        for (let j = 0; j < notes.length; j++) {
          if (i === j || edges.has(edgeId(notes[i].path, notes[j].path)) || edges.has(edgeId(notes[j].path, notes[i].path))) continue;
          let inter = 0;
          for (const w of sets[i]) if (sets[j].has(w)) inter++;
          const s = inter / Math.max(1, sets[i].size + sets[j].size - inter);
          if (s > bestScore) [best, bestScore] = [j, s];
        }
        if (best > i && bestScore >= threshold * 0.6) out.push({ source: notes[i].path, target: notes[best].path, score: bestScore });
      }
      return out;
    },
    readAppFile: async (key) => localStorage.getItem(`amethyst:${name}:${key}`),
    writeAppFile: async (key, contents) => localStorage.setItem(`amethyst:${name}:${key}`, contents),
    revealInFinder: async () => {},
    revealVault: async () => {},
    openInDefaultApp: async () => {},
    saveAttachment: async (name, bytes, near) => {
      const folder = folders.has('attachments') ? 'attachments' : near ? parentOf(near) : '';
      let path = folder ? `${folder}/${name}` : name;
      let i = 1;
      while (files.has(path)) path = (folder ? `${folder}/` : '') + name.replace(/(\.[^.]*)?$/, ` ${i++}$1`);
      const url = URL.createObjectURL(new Blob([bytes.slice()]));
      blobUrls.set(path, url);
      addFile(path, '');
      emit({ added: [path] });
      return path;
    },
    quitApp: async () => {},
    assetUrl: (path) => {
      const blob = blobUrls.get(path);
      if (blob) return blob;
      const f = files.get(path);
      if (f && /\.svg$/i.test(path)) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.text)}`;
      return '';
    },
    onVaultChanged: async (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    onMenu: async () => () => {},
  };
}

import { create } from 'zustand';
import { api } from '../api';

export type Mode = 'write' | 'graph';
export type LeftTab = 'files' | 'search' | 'tags';
export type ViewMode = 'edit' | 'read';

export type Overlay =
  | { kind: 'palette' }
  | { kind: 'switcher' }
  | { kind: 'settings' }
  | {
      kind: 'prompt';
      title: string;
      label: string;
      initial: string;
      confirm: string;
      onSubmit: (value: string) => void | Promise<void>;
    }
  | {
      kind: 'confirm';
      title: string;
      body: string;
      confirm: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    };

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

interface PathState {
  from: string | null;
  to: string | null;
  result: string[] | null;
  searched: boolean;
}

interface TimelapseState {
  playing: boolean;
  t: number;
  speed: number;
}

interface WorkspaceStore {
  mode: Mode;
  tabs: string[];
  active: string | null;
  viewModes: Record<string, ViewMode>;
  leftTab: LeftTab;
  leftOpen: boolean;
  rightOpen: boolean;
  overlay: Overlay | null;
  hud: { radar: boolean; path: boolean; timelapse: boolean };
  focusId: string | null;
  selectedId: string | null;
  highlight: { ids: string[]; label: string } | null;
  path: PathState;
  timelapse: TimelapseState;
  pendingLine: { path: string; line: number } | null;
  searchQuery: string;
  toasts: Toast[];
  history: string[];
  historyIndex: number;
  /** A freshly created note whose title should take focus when it opens. */
  titleFocus: string | null;

  load(): Promise<void>;
  persistNow(): Promise<void>;
  openNote(path: string, opts?: { newTab?: boolean; line?: number; keepMode?: boolean; fromHistory?: boolean }): void;
  back(): void;
  forward(): void;
  setTitleFocus(path: string | null): void;
  closeTab(path?: string): void;
  setTabs(tabs: string[], active: string | null): void;
  moveTab(path: string, index: number): void;
  setActive(path: string): void;
  setMode(mode: Mode): void;
  toggleMode(): void;
  toggleViewMode(path?: string): void;
  setLeftTab(tab: LeftTab): void;
  toggleLeft(): void;
  toggleRight(): void;
  setOverlay(o: Overlay | null): void;
  toggleHud(key: keyof WorkspaceStore['hud'], value?: boolean): void;
  setFocus(id: string | null): void;
  select(id: string | null): void;
  setHighlight(h: WorkspaceStore['highlight']): void;
  setPath(p: Partial<PathState>): void;
  setTimelapse(t: Partial<TimelapseState>): void;
  setSearchQuery(q: string): void;
  consumePendingLine(): void;
  renamePaths(map: Record<string, string>): void;
  forgetPaths(paths: string[]): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
}

const MAX_TABS = 12;
let toastId = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => get().persistNow(), 600);
  };

  return {
    mode: 'write',
    tabs: [],
    active: null,
    viewModes: {},
    leftTab: 'files',
    leftOpen: true,
    rightOpen: true,
    overlay: null,
    hud: { radar: false, path: false, timelapse: false },
    focusId: null,
    selectedId: null,
    highlight: null,
    path: { from: null, to: null, result: null, searched: false },
    timelapse: { playing: false, t: 1, speed: 1 },
    pendingLine: null,
    searchQuery: '',
    toasts: [],
    history: [],
    historyIndex: -1,
    titleFocus: null,

    async load() {
      let stored: Partial<{ tabs: string[]; active: string | null; mode: Mode; leftOpen: boolean; rightOpen: boolean; viewModes: Record<string, ViewMode> }> = {};
      try {
        const raw = await api.readAppFile('workspace');
        if (raw) stored = JSON.parse(raw);
      } catch {
        stored = {};
      }
      const tabs = (stored.tabs ?? []).slice(0, MAX_TABS);
      set({
        tabs,
        active: stored.active && tabs.includes(stored.active) ? stored.active : tabs[0] ?? null,
        mode: stored.mode ?? 'write',
        leftOpen: stored.leftOpen ?? true,
        rightOpen: stored.rightOpen ?? true,
        viewModes: stored.viewModes ?? {},
        focusId: stored.active ?? null,
        selectedId: null,
        highlight: null,
        overlay: null,
        path: { from: null, to: null, result: null, searched: false },
        hud: { radar: false, path: false, timelapse: false },
        timelapse: { playing: false, t: 1, speed: 1 },
        history: stored.active ? [stored.active] : [],
        historyIndex: stored.active ? 0 : -1,
        titleFocus: null,
      });
    },

    async persistNow() {
      const { tabs, active, mode, leftOpen, rightOpen, viewModes } = get();
      try {
        await api.writeAppFile('workspace', JSON.stringify({ tabs, active, mode, leftOpen, rightOpen, viewModes }, null, 2));
      } catch {
        /* vault closed */
      }
    },

    openNote(path, opts = {}) {
      const { tabs, active, history, historyIndex } = get();
      let next = tabs;
      if (!tabs.includes(path)) {
        if (opts.newTab || !active) next = [...tabs, path].slice(-MAX_TABS);
        else next = tabs.map((t) => (t === active ? path : t));
      }
      let nextHistory = history;
      let nextIndex = historyIndex;
      if (!opts.fromHistory && history[historyIndex] !== path) {
        nextHistory = [...history.slice(0, historyIndex + 1), path].slice(-100);
        nextIndex = nextHistory.length - 1;
      }
      set({
        tabs: next,
        active: path,
        focusId: path,
        selectedId: path,
        history: nextHistory,
        historyIndex: nextIndex,
        pendingLine: opts.line != null ? { path, line: opts.line } : null,
        ...(opts.keepMode ? {} : { mode: 'write' as Mode }),
      });
      persist();
    },

    back() {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      set({ historyIndex: historyIndex - 1 });
      get().openNote(history[historyIndex - 1], { fromHistory: true });
    },

    forward() {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      set({ historyIndex: historyIndex + 1 });
      get().openNote(history[historyIndex + 1], { fromHistory: true });
    },

    setTitleFocus(titleFocus) {
      set({ titleFocus });
    },

    closeTab(path) {
      const { tabs, active } = get();
      const target = path ?? active;
      if (!target) return;
      const idx = tabs.indexOf(target);
      const next = tabs.filter((t) => t !== target);
      const nextActive = target === active ? next[Math.min(idx, next.length - 1)] ?? null : active;
      set({ tabs: next, active: nextActive, focusId: nextActive });
      persist();
    },

    setTabs(tabs, active) {
      set({ tabs, active, focusId: active });
      persist();
    },

    moveTab(path, index) {
      const tabs = get().tabs.filter((t) => t !== path);
      tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, path);
      set({ tabs });
      persist();
    },

    setActive(path) {
      set({ active: path, focusId: path, selectedId: path });
      persist();
    },

    setMode(mode) {
      set({ mode });
      persist();
    },

    toggleMode() {
      get().setMode(get().mode === 'write' ? 'graph' : 'write');
    },

    toggleViewMode(path) {
      const target = path ?? get().active;
      if (!target) return;
      const current = get().viewModes[target] ?? 'edit';
      set({ viewModes: { ...get().viewModes, [target]: current === 'edit' ? 'read' : 'edit' } });
      persist();
    },

    setLeftTab(tab) {
      set({ leftTab: tab, leftOpen: true });
    },

    toggleLeft() {
      set({ leftOpen: !get().leftOpen });
      persist();
    },

    toggleRight() {
      set({ rightOpen: !get().rightOpen });
      persist();
    },

    setOverlay(overlay) {
      set({ overlay });
    },

    toggleHud(key, value) {
      const hud = { ...get().hud, [key]: value ?? !get().hud[key] };
      set({ hud });
      if (key === 'timelapse') {
        set({ timelapse: { ...get().timelapse, playing: hud.timelapse, t: hud.timelapse ? 0 : 1 } });
      }
      if (key === 'path' && !hud.path) {
        set({ path: { from: null, to: null, result: null, searched: false } });
      }
    },

    setFocus(focusId) {
      set({ focusId });
    },

    select(selectedId) {
      set({ selectedId });
    },

    setHighlight(highlight) {
      set({ highlight });
    },

    setPath(p) {
      set({ path: { ...get().path, ...p } });
    },

    setTimelapse(t) {
      set({ timelapse: { ...get().timelapse, ...t } });
    },

    setSearchQuery(searchQuery) {
      set({ searchQuery });
    },

    consumePendingLine() {
      set({ pendingLine: null });
    },

    renamePaths(map) {
      const rename = (p: string | null) => (p && map[p] ? map[p] : p);
      const { tabs, active, focusId, selectedId, viewModes, history } = get();
      const nextModes: Record<string, ViewMode> = {};
      for (const [k, v] of Object.entries(viewModes)) nextModes[rename(k)!] = v;
      set({
        tabs: tabs.map((t) => rename(t)!),
        active: rename(active),
        focusId: rename(focusId),
        selectedId: rename(selectedId),
        viewModes: nextModes,
        history: history.map((h) => rename(h)!),
      });
      persist();
    },

    forgetPaths(paths) {
      const gone = new Set(paths);
      const { tabs, active, history, historyIndex } = get();
      const kept = history.filter((h) => !gone.has(h));
      if (kept.length !== history.length) {
        set({ history: kept, historyIndex: Math.min(kept.length - 1, Math.max(0, historyIndex - (history.length - kept.length))) });
      }
      if (!tabs.some((t) => gone.has(t))) return;
      const next = tabs.filter((t) => !gone.has(t));
      const nextActive = active && gone.has(active) ? next[0] ?? null : active;
      set({ tabs: next, active: nextActive, focusId: nextActive });
      persist();
    },

    toast(text, tone = 'info') {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, text, tone }] });
      setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 3200);
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
  };
});

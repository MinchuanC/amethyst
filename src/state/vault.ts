import { create } from 'zustand';
import {
  api,
  type FileEntry,
  type GhostLink,
  type LinkTarget,
  type RecentVault,
  type VaultChange,
  type VaultInfo,
} from '../api';
import { GraphModel, type DeltaSummary } from '../graph/model';
import { useSettings } from './settings';
import { useWorkspace } from './workspace';

export const graphModel = new GraphModel();

type ChangeListener = (change: VaultChange, summary: DeltaSummary) => void;
const changeListeners = new Set<ChangeListener>();

export function onVaultChange(cb: ChangeListener) {
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

interface VaultStore {
  info: VaultInfo | null;
  status: 'idle' | 'opening' | 'ready';
  error: string | null;
  recent: RecentVault[];
  files: FileEntry[];
  linkTargets: LinkTarget[];
  graphVersion: number;
  /** Bumps only when nodes or links are added or removed, not on edits. */
  structureVersion: number;
  lastChange: { summary: DeltaSummary; origin: VaultChange['origin']; at: number } | null;
  ghostLinks: GhostLink[];
  init(): Promise<void>;
  open(path: string): Promise<void>;
  pickAndOpen(): Promise<void>;
  close(): Promise<void>;
  removeRecent(path: string): Promise<void>;
  refreshFiles(): Promise<void>;
  loadGhostLinks(): Promise<void>;
}

let unsubscribe: (() => void) | null = null;
let targetsTimer: ReturnType<typeof setTimeout> | undefined;

export const useVault = create<VaultStore>((set, get) => ({
  info: null,
  status: 'idle',
  error: null,
  recent: [],
  files: [],
  linkTargets: [],
  graphVersion: 0,
  structureVersion: 0,
  lastChange: null,
  ghostLinks: [],

  async init() {
    if (!unsubscribe) {
      unsubscribe = await api.onVaultChanged((change) => applyChange(change));
    }
    const [current, recent] = await Promise.all([api.currentVault(), api.listRecentVaults()]);
    set({ recent });
    if (current) {
      await get().open(current.root);
    } else if (!api.isNative) {
      await get().open(recent[0]?.path ?? '/mock/sample-vault');
    }
  },

  async open(path) {
    set({ status: 'opening', error: null });
    try {
      const info = await api.openVault(path);
      const [files, snapshot, linkTargets] = await Promise.all([
        api.listFiles(),
        api.graphSnapshot(),
        api.linkTargets(),
        useSettings.getState().load(),
      ]);
      graphModel.load(snapshot);
      await useWorkspace.getState().load();
      set({
        info,
        files,
        linkTargets,
        status: 'ready',
        graphVersion: get().graphVersion + 1,
        structureVersion: get().structureVersion + 1,
        lastChange: null,
        ghostLinks: [],
        recent: await api.listRecentVaults(),
      });
      if (useSettings.getState().showGhostLinks) get().loadGhostLinks();
    } catch (e) {
      set({ status: get().info ? 'ready' : 'idle', error: String(e) });
    }
  },

  async pickAndOpen() {
    const path = await api.pickVaultFolder();
    if (path) await get().open(path);
  },

  async close() {
    await useWorkspace.getState().persistNow();
    await api.closeVault();
    graphModel.load({ nodes: [], edges: [] });
    set({ info: null, status: 'idle', files: [], linkTargets: [], recent: await api.listRecentVaults() });
  },

  async removeRecent(path) {
    await api.removeRecentVault(path);
    set({ recent: await api.listRecentVaults() });
  },

  async refreshFiles() {
    const [files, linkTargets] = await Promise.all([api.listFiles(), api.linkTargets()]);
    set({ files, linkTargets });
  },

  async loadGhostLinks() {
    try {
      set({ ghostLinks: await api.ghostLinks(), graphVersion: get().graphVersion + 1 });
    } catch {
      set({ ghostLinks: [] });
    }
  },
}));

function applyChange(change: VaultChange) {
  const store = useVault.getState();
  if (!store.info) return;
  const summary = graphModel.applyDelta(change.delta);
  const graphChanged =
    summary.addedNodes.length + summary.changedNodes.length + summary.removedNodes.length + summary.addedEdges.length > 0 ||
    change.delta.removeEdges.length > 0;
  const structural =
    summary.addedNodes.length + summary.removedNodes.length + summary.addedEdges.length + change.delta.removeEdges.length > 0;
  if (graphChanged) {
    useVault.setState({
      graphVersion: store.graphVersion + 1,
      structureVersion: store.structureVersion + (structural ? 1 : 0),
      lastChange: { summary, origin: change.origin, at: performance.now() },
    });
  }
  if (change.added.length || change.removed.length || change.foldersChanged) {
    store.refreshFiles();
  } else if (change.changed.length) {
    clearTimeout(targetsTimer);
    targetsTimer = setTimeout(() => api.linkTargets().then((linkTargets) => useVault.setState({ linkTargets })), 800);
  }
  if (change.removed.length) useWorkspace.getState().forgetPaths(change.removed);
  changeListeners.forEach((l) => l(change, summary));
}

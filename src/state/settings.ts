import { create } from 'zustand';
import { api } from '../api';

export type ColorMode = 'cluster' | 'folder' | 'tag' | 'age';
export type Dimension = '3d' | '2d';

export interface Settings {
  dimension: Dimension;
  colorMode: ColorMode;
  showTags: boolean;
  showAttachments: boolean;
  showUnresolved: boolean;
  showOrphans: boolean;
  showGhostLinks: boolean;
  groupClusters: boolean;
  focusDepth: 1 | 2 | 3;
  linkFlow: boolean;
  bloom: number;
  sounds: boolean;
  livePreview: boolean;
  spellcheck: boolean;
  readableWidth: boolean;
  editorSize: 14 | 16 | 18 | 20;
}

export const DEFAULT_SETTINGS: Settings = {
  dimension: '3d',
  colorMode: 'cluster',
  showTags: false,
  showAttachments: false,
  showUnresolved: true,
  showOrphans: true,
  showGhostLinks: false,
  groupClusters: true,
  focusDepth: 2,
  linkFlow: true,
  bloom: 1,
  sounds: false,
  livePreview: true,
  spellcheck: true,
  readableWidth: true,
  editorSize: 16,
};

interface SettingsStore extends Settings {
  loaded: boolean;
  load(): Promise<void>;
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  toggle(key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(state: Settings) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out: Partial<Settings> = {};
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) (out as Record<string, unknown>)[k] = state[k];
    api.writeAppFile('settings', JSON.stringify(out, null, 2)).catch(() => {});
  }, 400);
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    let stored: Partial<Settings> = {};
    try {
      const raw = await api.readAppFile('settings');
      if (raw) stored = JSON.parse(raw);
    } catch {
      stored = {};
    }
    set({ ...DEFAULT_SETTINGS, ...stored, loaded: true });
  },
  set(key, value) {
    set({ [key]: value } as Partial<SettingsStore>);
    persist(get());
  },
  toggle(key) {
    set({ [key]: !get()[key] } as Partial<SettingsStore>);
    persist(get());
  },
}));

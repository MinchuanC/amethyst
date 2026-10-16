import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  Backend,
  FileEntry,
  GhostLink,
  GraphSnapshot,
  LinkTarget,
  Mention,
  NoteLinks,
  RecentVault,
  RenameResult,
  SearchHit,
  SimilarNote,
  VaultChange,
  VaultInfo,
} from './types';

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function createTauriBackend(): Backend {
  let root = '';
  const remember = (info: VaultInfo | null) => {
    root = info?.root ?? '';
    return info;
  };

  return {
    isNative: true,
    pickVaultFolder: () => invoke<string | null>('pick_vault_folder'),
    openVault: async (path) => remember(await invoke<VaultInfo>('open_vault', { path }))!,
    closeVault: async () => {
      root = '';
      await invoke('close_vault');
    },
    currentVault: async () => remember(await invoke<VaultInfo | null>('current_vault')),
    listRecentVaults: () => invoke<RecentVault[]>('list_recent_vaults'),
    removeRecentVault: (path) => invoke('remove_recent_vault', { path }),
    listFiles: () => invoke<FileEntry[]>('list_files'),
    graphSnapshot: () => invoke<GraphSnapshot>('graph_snapshot'),
    linkTargets: () => invoke<LinkTarget[]>('link_targets'),
    readNote: (path) => invoke<string>('read_note', { path }),
    writeNote: (path, contents) => invoke('write_note', { path, contents }),
    createNote: (path, contents) => invoke<string>('create_note', { path, contents: contents ?? null }),
    createFolder: (path) => invoke<string>('create_folder', { path }),
    renamePath: (from, to) => invoke<RenameResult>('rename_path', { from, to }),
    deletePath: (path) => invoke('delete_path', { path }),
    resolveLink: (target, from) => invoke<string | null>('resolve_link', { target, from }),
    noteLinks: (path) => invoke<NoteLinks>('note_links', { path }),
    unlinkedMentions: (path) => invoke<Mention[]>('unlinked_mentions', { path }),
    linkMention: (source, offset, length, target) =>
      invoke('link_mention', { source, offset, length, target }),
    search: (query, limit) => invoke<SearchHit[]>('search', { query, limit: limit ?? null }),
    similarNotes: (path, limit) => invoke<SimilarNote[]>('similar_notes', { path, limit: limit ?? null }),
    ghostLinks: (threshold, perNote) =>
      invoke<GhostLink[]>('ghost_links', { threshold: threshold ?? null, perNote: perNote ?? null }),
    readAppFile: (name) => invoke<string | null>('read_app_file', { name }),
    writeAppFile: (name, contents) => invoke('write_app_file', { name, contents }),
    revealInFinder: (path) => invoke('reveal_in_finder', { path }),
    revealVault: () => invoke('reveal_vault'),
    openInDefaultApp: (path) => invoke('open_in_default_app', { path }),
    saveAttachment: (name, bytes, near) => invoke<string>('save_attachment', { name, data: toBase64(bytes), near: near ?? null }),
    quitApp: () => invoke('quit_app'),
    assetUrl: (path) => convertFileSrc(`${root}/${path}`),
    onVaultChanged: (cb) => listen<VaultChange>('vault:changed', (e) => cb(e.payload)),
    onMenu: (cb) => listen<string>('menu', (e) => cb(e.payload)),
  };
}

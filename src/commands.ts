import { api } from './api';
import { confirmDelete, copyLinkTo, createNote, duplicateNote, noteFolder, openDailyNote, promptNewFolder, promptRename } from './actions';
import { bus } from './bus';
import { useSettings, type ColorMode } from './state/settings';
import { useVault } from './state/vault';
import { useWorkspace } from './state/workspace';
import { play } from './ui/sounds';

export interface Command {
  id: string;
  title: string | (() => string);
  section: 'Notes' | 'Graph' | 'View' | 'Vault';
  shortcut?: string;
  available?: () => boolean;
  run: () => void;
}

const ws = () => useWorkspace.getState();
const st = () => useSettings.getState();
const hasNote = () => !!ws().active;

const colorCommand = (mode: ColorMode, label: string): Command => ({
  id: `graph.color.${mode}`,
  title: `Color graph by ${label}`,
  section: 'Graph',
  available: () => st().colorMode !== mode,
  run: () => st().set('colorMode', mode),
});

const toggleCommand = (
  id: string,
  key: 'showTags' | 'showAttachments' | 'showOrphans' | 'showUnresolved' | 'groupClusters' | 'linkFlow' | 'sounds' | 'livePreview' | 'spellcheck',
  on: string,
  off: string,
  section: Command['section'] = 'Graph',
): Command => ({
  id,
  title: () => (st()[key] ? off : on),
  section,
  run: () => st().toggle(key),
});

export const commands: Command[] = [
  { id: 'palette.open', title: 'Show all commands', section: 'View', shortcut: '⌘K', run: () => ws().setOverlay({ kind: 'palette' }) },
  { id: 'switcher.open', title: 'Open note…', section: 'Notes', shortcut: '⌘O', run: () => ws().setOverlay({ kind: 'switcher' }) },
  {
    id: 'search.open',
    title: 'Search vault',
    section: 'Notes',
    shortcut: '⇧⌘F',
    run: () => {
      ws().setMode('write');
      ws().setLeftTab('search');
      setTimeout(() => bus.emit('search:focus'), 30);
    },
  },
  { id: 'note.new', title: 'New note', section: 'Notes', shortcut: '⌘N', run: () => void createNote(noteFolder(ws().active)) },
  { id: 'folder.new', title: 'New folder', section: 'Notes', run: () => promptNewFolder(noteFolder(ws().active)) },
  { id: 'note.today', title: 'Open today’s daily note', section: 'Notes', run: () => void openDailyNote() },
  {
    id: 'note.copyLink',
    title: 'Copy link to current note',
    section: 'Notes',
    available: () => hasNote() && /\.md$/i.test(ws().active!),
    run: () => void copyLinkTo(ws().active!),
  },
  {
    id: 'note.duplicate',
    title: 'Make a copy of current note',
    section: 'Notes',
    available: () => hasNote() && /\.md$/i.test(ws().active!),
    run: () => void duplicateNote(ws().active!),
  },
  { id: 'nav.back', title: 'Go back', section: 'Notes', shortcut: '⌘[', available: () => ws().historyIndex > 0, run: () => ws().back() },
  {
    id: 'nav.forward',
    title: 'Go forward',
    section: 'Notes',
    shortcut: '⌘]',
    available: () => ws().historyIndex < ws().history.length - 1,
    run: () => ws().forward(),
  },
  { id: 'note.rename', title: 'Rename current note', section: 'Notes', available: hasNote, run: () => promptRename(ws().active!) },
  { id: 'note.delete', title: 'Move current note to trash', section: 'Notes', available: hasNote, run: () => confirmDelete(ws().active!) },
  {
    id: 'note.reveal',
    title: 'Reveal current note in Finder',
    section: 'Notes',
    available: () => hasNote() && api.isNative,
    run: () => void api.revealInFinder(ws().active!),
  },
  {
    id: 'note.reading',
    title: () => ((ws().viewModes[ws().active ?? ''] ?? 'edit') === 'edit' ? 'Switch to reading view' : 'Switch to editing view'),
    section: 'Notes',
    shortcut: '⌘E',
    available: hasNote,
    run: () => ws().toggleViewMode(),
  },
  { id: 'tab.close', title: 'Close tab', section: 'Notes', shortcut: '⌘W', available: hasNote, run: () => ws().closeTab() },

  {
    id: 'mode.toggle',
    title: () => (ws().mode === 'write' ? 'Enter graph mode' : 'Back to writing'),
    section: 'Graph',
    shortcut: '⌘G',
    run: () => {
      ws().toggleMode();
      play('whoosh');
    },
  },
  {
    id: 'graph.dimension',
    title: () => (st().dimension === '3d' ? 'Flatten graph to 2D' : 'Expand graph to 3D'),
    section: 'Graph',
    shortcut: '⇧⌘D',
    run: () => st().set('dimension', st().dimension === '3d' ? '2d' : '3d'),
  },
  {
    id: 'graph.focus',
    title: 'Focus current note in graph',
    section: 'Graph',
    available: hasNote,
    run: () => {
      ws().setMode('graph');
      ws().setFocus(ws().active);
    },
  },
  { id: 'graph.recenter', title: 'Recenter graph', section: 'Graph', run: () => bus.emit('graph:recenter') },
  {
    id: 'graph.radar',
    title: () => (ws().hud.radar ? 'Close Vault Radar' : 'Open Vault Radar'),
    section: 'Graph',
    shortcut: '⇧⌘R',
    run: () => {
      ws().setMode('graph');
      ws().toggleHud('radar');
    },
  },
  {
    id: 'graph.path',
    title: 'Find path between two notes',
    section: 'Graph',
    shortcut: '⇧⌘P',
    run: () => {
      ws().setMode('graph');
      ws().toggleHud('path', true);
      if (ws().active && !ws().path.from) ws().setPath({ from: ws().active });
    },
  },
  {
    id: 'graph.timelapse',
    title: () => (ws().hud.timelapse ? 'Stop time-lapse' : 'Play vault time-lapse'),
    section: 'Graph',
    shortcut: '⇧⌘T',
    run: () => {
      ws().setMode('graph');
      ws().toggleHud('timelapse');
    },
  },
  colorCommand('cluster', 'cluster'),
  colorCommand('folder', 'folder'),
  colorCommand('tag', 'tag'),
  colorCommand('age', 'age'),
  toggleCommand('graph.tags', 'showTags', 'Show tags in graph', 'Hide tags in graph'),
  toggleCommand('graph.attachments', 'showAttachments', 'Show attachments in graph', 'Hide attachments in graph'),
  toggleCommand('graph.orphans', 'showOrphans', 'Show orphan notes in graph', 'Hide orphan notes in graph'),
  toggleCommand('graph.unresolved', 'showUnresolved', 'Show notes that don’t exist yet', 'Hide notes that don’t exist yet'),
  toggleCommand('graph.grouping', 'groupClusters', 'Pull clusters together', 'Stop pulling clusters together'),
  toggleCommand('graph.flow', 'linkFlow', 'Animate link flow', 'Stop link flow animation'),
  {
    id: 'graph.ghosts',
    title: () => (st().showGhostLinks ? 'Hide similar-note ghost links' : 'Show similar-note ghost links'),
    section: 'Graph',
    run: () => {
      st().toggle('showGhostLinks');
      if (st().showGhostLinks) useVault.getState().loadGhostLinks();
    },
  },

  { id: 'view.left', title: () => (ws().leftOpen ? 'Hide sidebar' : 'Show sidebar'), section: 'View', run: () => ws().toggleLeft() },
  { id: 'view.right', title: () => (ws().rightOpen ? 'Hide links panel' : 'Show links panel'), section: 'View', run: () => ws().toggleRight() },
  { id: 'settings.open', title: 'Open settings', section: 'View', shortcut: '⌘,', run: () => ws().setOverlay({ kind: 'settings' }) },
  toggleCommand('settings.livepreview', 'livePreview', 'Turn on live preview', 'Turn off live preview', 'View'),
  toggleCommand('settings.spellcheck', 'spellcheck', 'Turn on spellcheck', 'Turn off spellcheck', 'View'),
  toggleCommand('settings.sounds', 'sounds', 'Turn on interface sounds', 'Turn off interface sounds', 'View'),

  { id: 'vault.open', title: 'Open another vault…', section: 'Vault', shortcut: '⇧⌘O', available: () => api.isNative, run: () => void useVault.getState().pickAndOpen() },
  { id: 'vault.reveal', title: 'Show vault in Finder', section: 'Vault', available: () => api.isNative, run: () => void api.revealVault() },
  { id: 'vault.close', title: 'Close vault', section: 'Vault', available: () => api.isNative, run: () => void useVault.getState().close() },
];

const byId = new Map(commands.map((c) => [c.id, c]));
const lastRun = new Map<string, number>();

export function titleOf(cmd: Command) {
  return typeof cmd.title === 'function' ? cmd.title() : cmd.title;
}

/**
 * Runs a command by id. Native menu accelerators and in-page key handlers
 * can both fire for one keystroke, so repeats within 150ms are ignored.
 */
export function runCommand(id: string) {
  const cmd = byId.get(id);
  if (!cmd || !useVault.getState().info) return;
  const now = performance.now();
  if (now - (lastRun.get(id) ?? -Infinity) < 150) return;
  lastRun.set(id, now);
  if (cmd.available && !cmd.available()) return;
  cmd.run();
}

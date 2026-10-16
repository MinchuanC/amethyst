import { api, UNRESOLVED_PREFIX } from './api';
import { flushEditor, noteRenamed } from './editor/bridge';
import { TAG_PREFIX } from './graph/model';
import { graphModel, useVault } from './state/vault';
import { useWorkspace } from './state/workspace';

const ws = () => useWorkspace.getState();

function report(e: unknown) {
  ws().toast(String(e).replace(/^Error:\s*/, ''), 'error');
}

const stripMd = (p: string) => p.replace(/\.md$/i, '');
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * Renames or moves a file or folder. Unsaved edits are written first, and
 * open tabs follow the file to its new path.
 */
export async function renameTracked(from: string, to: string) {
  await flushEditor();
  const result = await api.renamePath(from, to);
  const map: Record<string, string> = {};
  for (const tab of ws().tabs) {
    if (tab === from) map[tab] = result.newPath;
    else if (tab.startsWith(`${from}/`)) map[tab] = result.newPath + tab.slice(from.length);
  }
  for (const [a, b] of Object.entries(map)) noteRenamed(a, b);
  ws().renamePaths(map);
  return result;
}

export async function createNote(folder = '', name = 'Untitled', contents = '') {
  try {
    const path = await api.createNote(folder ? `${folder}/${name}` : name, contents);
    ws().openNote(path, { newTab: true });
    if (name === 'Untitled') ws().setTitleFocus(path);
    return path;
  } catch (e) {
    report(e);
    return null;
  }
}

function localDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Opens (or creates) today's note in the Journal or Daily folder, if the vault has one. */
export async function openDailyNote() {
  const today = localDate();
  const { files } = useVault.getState();
  const folder =
    files.find((f) => f.kind === 'folder' && !f.path.includes('/') && /^(journal|daily|daily notes)$/i.test(f.path))?.path ?? '';
  const path = `${folder ? `${folder}/` : ''}${today}.md`;
  if (files.some((f) => f.path === path)) {
    ws().openNote(path);
    return;
  }
  try {
    const created = await api.createNote(path, `---\ncreated: ${today}\n---\n# ${today}\n\n`);
    ws().openNote(created, { line: 4 });
  } catch (e) {
    report(e);
  }
}

export async function copyLinkTo(path: string) {
  const title = path.split('/').pop()!.replace(/\.md$/i, '');
  try {
    await navigator.clipboard.writeText(`[[${title}]]`);
    ws().toast(`Copied [[${title}]]`);
  } catch (e) {
    report(e);
  }
}

export async function duplicateNote(path: string) {
  try {
    await flushEditor();
    const text = await api.readNote(path);
    const title = path.split('/').pop()!.replace(/\.md$/i, '');
    await createNote(parentOf(path), `${title} copy`, text);
  } catch (e) {
    report(e);
  }
}

export function promptNewFolder(parent = '') {
  ws().setOverlay({
    kind: 'prompt',
    title: 'New folder',
    label: parent ? `Inside ${parent}` : 'At the vault root',
    initial: 'New folder',
    confirm: 'Create folder',
    onSubmit: async (value) => {
      try {
        await api.createFolder(parent ? `${parent}/${value}` : value);
      } catch (e) {
        report(e);
      }
    },
  });
}

export function promptRename(path: string, isFolder = false) {
  ws().setOverlay({
    kind: 'prompt',
    title: isFolder ? 'Rename folder' : 'Rename note',
    label: 'Include folders to move it, e.g. Projects/Idea. Links to it update automatically.',
    initial: isFolder ? path : stripMd(path),
    confirm: 'Rename',
    onSubmit: async (value) => {
      const to = value.trim().replace(/^\/+|\/+$/g, '');
      if (!to || to === (isFolder ? path : stripMd(path))) return;
      try {
        const result = await renameTracked(path, isFolder ? to : `${to}.md`);
        const files = result.updatedFiles.length;
        ws().toast(
          result.updatedLinks
            ? `Renamed. Updated ${result.updatedLinks} link${result.updatedLinks === 1 ? '' : 's'} in ${files} note${files === 1 ? '' : 's'}.`
            : 'Renamed.',
        );
      } catch (e) {
        report(e);
      }
    },
  });
}

export function confirmDelete(path: string, isFolder = false) {
  const name = path.split('/').pop()!;
  ws().setOverlay({
    kind: 'confirm',
    title: isFolder ? `Move folder “${name}” to trash?` : `Move “${stripMd(name)}” to trash?`,
    body: 'It goes to the .trash folder inside this vault, so you can restore it from Finder.',
    confirm: 'Move to trash',
    danger: true,
    onConfirm: async () => {
      try {
        await flushEditor();
        await api.deletePath(path);
        ws().toast('Moved to trash.');
      } catch (e) {
        report(e);
      }
    },
  });
}

/** Follows a [[link]]: opens the resolved note, or creates it like Obsidian does. */
export async function followLink(target: string, from: string, newTab = false) {
  try {
    const resolved = await api.resolveLink(target, from);
    if (resolved) {
      if (/\.md$/i.test(resolved)) ws().openNote(resolved, { newTab });
      else revealOrPreview(resolved);
      return;
    }
    const path = await api.createNote(target, '');
    ws().openNote(path, { newTab });
    ws().toast(`Created “${target}”.`);
  } catch (e) {
    report(e);
  }
}

/** Attachments open in a viewer tab of their own. */
function revealOrPreview(path: string) {
  ws().openNote(path);
}

/** Opens a graph node: notes open in the editor, ghosts get created. */
export async function openNode(id: string, newTab = false) {
  if (id.startsWith(TAG_PREFIX)) {
    ws().setSearchQuery(`#${id.slice(TAG_PREFIX.length)}`);
    ws().setLeftTab('search');
    ws().setMode('write');
    return;
  }
  if (id.startsWith(UNRESOLVED_PREFIX)) {
    const display = graphModel.nodes.get(id)?.title ?? id.slice(UNRESOLVED_PREFIX.length);
    try {
      const path = await api.createNote(display, '');
      ws().openNote(path, { newTab });
      ws().toast(`Created “${display}”.`);
    } catch (e) {
      report(e);
    }
    return;
  }
  if (/\.md$/i.test(id)) ws().openNote(id, { newTab });
  else revealOrPreview(id);
}

export function noteFolder(path: string | null) {
  return path ? parentOf(path) : '';
}

export function openExternal(url: string) {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (api.isNative) {
    import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_external', { url })).catch(report);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export { report as reportError };

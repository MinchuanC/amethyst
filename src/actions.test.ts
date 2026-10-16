// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmDelete, noteFolder, openExternal, openNode, promptRename } from './actions';
import { TAG_PREFIX } from './graph/model';
import { useWorkspace } from './state/workspace';

describe('action helpers', () => {
  beforeEach(() => {
    useWorkspace.setState({
      tabs: [],
      active: null,
      overlay: null,
      searchQuery: '',
      leftTab: 'files',
      mode: 'graph',
      toasts: [],
    });
  });

  it('takes the parent folder of a note path', () => {
    expect(noteFolder('Astronomy/Nebulae.md')).toBe('Astronomy');
    expect(noteFolder('Welcome.md')).toBe('');
    expect(noteFolder(null)).toBe('');
  });

  it('only opens http(s) and mailto URLs', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openExternal('javascript:alert(1)');
    openExternal('/local');
    expect(open).not.toHaveBeenCalled();
    openExternal('https://example.com');
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
    open.mockRestore();
  });

  it('opens a tag node as a search and an unresolved node as a new note prompt path', async () => {
    openNode(`${TAG_PREFIX}space`);
    expect(useWorkspace.getState().searchQuery).toBe('#space');
    expect(useWorkspace.getState().leftTab).toBe('search');
    expect(useWorkspace.getState().mode).toBe('write');
  });

  it('opens a markdown node in a tab', async () => {
    await openNode('Astronomy/Nebulae.md');
    expect(useWorkspace.getState().active).toBe('Astronomy/Nebulae.md');
    expect(useWorkspace.getState().tabs).toContain('Astronomy/Nebulae.md');
  });

  it('puts a delete confirmation on the overlay', () => {
    confirmDelete('Astronomy/Nebulae.md');
    const overlay = useWorkspace.getState().overlay;
    expect(overlay?.kind).toBe('confirm');
    if (overlay?.kind === 'confirm') {
      expect(overlay.danger).toBe(true);
      expect(overlay.title).toContain('Nebulae');
    }
  });

  it('puts a rename prompt on the overlay with the stem as the initial value', () => {
    promptRename('Astronomy/Nebulae.md');
    const overlay = useWorkspace.getState().overlay;
    expect(overlay?.kind).toBe('prompt');
    if (overlay?.kind === 'prompt') {
      expect(overlay.initial).toBe('Astronomy/Nebulae');
    }
  });
});

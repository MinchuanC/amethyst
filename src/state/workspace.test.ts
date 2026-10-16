// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from './workspace';

function reset() {
  useWorkspace.setState({
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
  });
}

describe('workspace tabs and history', () => {
  beforeEach(reset);

  it('opens the first note in a new tab and later notes replace the active tab', () => {
    const ws = useWorkspace.getState();
    ws.openNote('A.md');
    ws.openNote('B.md');
    expect(useWorkspace.getState().tabs).toEqual(['B.md']);
    ws.openNote('C.md', { newTab: true });
    expect(useWorkspace.getState().tabs).toEqual(['B.md', 'C.md']);
    expect(useWorkspace.getState().active).toBe('C.md');
    expect(useWorkspace.getState().mode).toBe('write');
  });

  it('caps open tabs at 12', () => {
    const ws = useWorkspace.getState();
    for (let i = 0; i < 14; i++) ws.openNote(`N${i}.md`, { newTab: true });
    expect(useWorkspace.getState().tabs).toHaveLength(12);
    expect(useWorkspace.getState().tabs[0]).toBe('N2.md');
  });

  it('walks back and forward through history without forking on replay', () => {
    const ws = useWorkspace.getState();
    ws.openNote('A.md', { newTab: true });
    ws.openNote('B.md', { newTab: true });
    ws.openNote('C.md', { newTab: true });
    ws.back();
    expect(useWorkspace.getState().active).toBe('B.md');
    ws.back();
    expect(useWorkspace.getState().active).toBe('A.md');
    ws.forward();
    expect(useWorkspace.getState().active).toBe('B.md');
    expect(useWorkspace.getState().history).toEqual(['A.md', 'B.md', 'C.md']);
  });

  it('closes the active tab and activates a neighbour', () => {
    const ws = useWorkspace.getState();
    ws.openNote('A.md', { newTab: true });
    ws.openNote('B.md', { newTab: true });
    ws.openNote('C.md', { newTab: true });
    ws.closeTab('B.md');
    expect(useWorkspace.getState().tabs).toEqual(['A.md', 'C.md']);
    expect(useWorkspace.getState().active).toBe('C.md');
    ws.closeTab();
    expect(useWorkspace.getState().active).toBe('A.md');
  });

  it('reorders tabs and keeps the same active note', () => {
    const ws = useWorkspace.getState();
    ws.openNote('A.md', { newTab: true });
    ws.openNote('B.md', { newTab: true });
    ws.openNote('C.md', { newTab: true });
    ws.moveTab('C.md', 0);
    expect(useWorkspace.getState().tabs).toEqual(['C.md', 'A.md', 'B.md']);
    expect(useWorkspace.getState().active).toBe('C.md');
  });
});

describe('workspace modes and HUD', () => {
  beforeEach(reset);

  it('toggles write/graph and edit/read independently', () => {
    const ws = useWorkspace.getState();
    ws.openNote('A.md');
    ws.toggleMode();
    expect(useWorkspace.getState().mode).toBe('graph');
    ws.toggleViewMode();
    expect(useWorkspace.getState().viewModes['A.md']).toBe('read');
    ws.toggleViewMode('A.md');
    expect(useWorkspace.getState().viewModes['A.md']).toBe('edit');
  });

  it('opens a sidebar tab and can hide both docks', () => {
    const ws = useWorkspace.getState();
    ws.toggleLeft();
    expect(useWorkspace.getState().leftOpen).toBe(false);
    ws.setLeftTab('search');
    expect(useWorkspace.getState().leftTab).toBe('search');
    expect(useWorkspace.getState().leftOpen).toBe(true);
    ws.toggleRight();
    expect(useWorkspace.getState().rightOpen).toBe(false);
  });

  it('resets path finder state when that HUD closes', () => {
    const ws = useWorkspace.getState();
    ws.toggleHud('path', true);
    ws.setPath({ from: 'A.md', to: 'B.md', result: ['A.md', 'B.md'], searched: true });
    ws.toggleHud('path', false);
    expect(useWorkspace.getState().path).toEqual({ from: null, to: null, result: null, searched: false });
  });

  it('rewinds the time-lapse when it is opened', () => {
    const ws = useWorkspace.getState();
    ws.toggleHud('timelapse', true);
    expect(useWorkspace.getState().hud.timelapse).toBe(true);
    expect(useWorkspace.getState().timelapse.playing).toBe(true);
    expect(useWorkspace.getState().timelapse.t).toBe(0);
  });

  it('rewrites open tabs and history after a rename, and drops deleted paths', () => {
    const ws = useWorkspace.getState();
    ws.openNote('Old.md', { newTab: true });
    ws.openNote('Keep.md', { newTab: true });
    ws.toggleViewMode('Old.md');
    ws.renamePaths({ 'Old.md': 'New.md' });
    expect(useWorkspace.getState().tabs).toEqual(['New.md', 'Keep.md']);
    expect(useWorkspace.getState().history).toContain('New.md');
    expect(useWorkspace.getState().viewModes['New.md']).toBe('read');
    ws.forgetPaths(['New.md']);
    expect(useWorkspace.getState().tabs).toEqual(['Keep.md']);
    expect(useWorkspace.getState().active).toBe('Keep.md');
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands, runCommand, titleOf } from './commands';
import { DEFAULT_SETTINGS, useSettings } from './state/settings';
import { useVault } from './state/vault';
import { useWorkspace } from './state/workspace';

describe('command catalog', () => {
  it('covers notes, graph, view and vault, and every id is unique', () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of ['Notes', 'Graph', 'View', 'Vault'] as const) {
      expect(commands.some((c) => c.section === section), section).toBe(true);
    }
    for (const id of [
      'note.new',
      'note.today',
      'note.duplicate',
      'note.copyLink',
      'note.reading',
      'search.open',
      'mode.toggle',
      'graph.radar',
      'graph.path',
      'graph.timelapse',
      'graph.dimension',
      'settings.open',
      'vault.close',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('titles reflect the current mode', () => {
    useWorkspace.setState({ mode: 'write' });
    expect(titleOf(commands.find((c) => c.id === 'mode.toggle')!)).toBe('Enter graph mode');
    useWorkspace.setState({ mode: 'graph' });
    expect(titleOf(commands.find((c) => c.id === 'mode.toggle')!)).toBe('Back to writing');
  });
});

describe('runCommand', () => {
  beforeEach(() => {
    useSettings.setState({ ...DEFAULT_SETTINGS, loaded: true });
    useWorkspace.setState({
      mode: 'write',
      tabs: ['A.md'],
      active: 'A.md',
      overlay: null,
      hud: { radar: false, path: false, timelapse: false },
      history: ['A.md'],
      historyIndex: 0,
    });
    useVault.setState({
      info: { root: '/mock/sample', name: 'sample', noteCount: 1, fileCount: 1 },
    });
  });

  it('does nothing when no vault is open', () => {
    useVault.setState({ info: null });
    runCommand('mode.toggle');
    expect(useWorkspace.getState().mode).toBe('write');
  });

  it('runs an available command and ignores a repeat inside 150ms', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1040);
    runCommand('mode.toggle');
    expect(useWorkspace.getState().mode).toBe('graph');
    runCommand('mode.toggle');
    expect(useWorkspace.getState().mode).toBe('graph');
  });

  it('skips a command that is not available', () => {
    useWorkspace.setState({ active: null, tabs: [] });
    runCommand('tab.close');
    expect(useWorkspace.getState().tabs).toEqual([]);
  });

  it('opens settings and the path finder', () => {
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    runCommand('settings.open');
    expect(useWorkspace.getState().overlay).toEqual({ kind: 'settings' });
    vi.spyOn(performance, 'now').mockReturnValue(6000);
    runCommand('graph.path');
    expect(useWorkspace.getState().mode).toBe('graph');
    expect(useWorkspace.getState().hud.path).toBe(true);
    expect(useWorkspace.getState().path.from).toBe('A.md');
  });
});

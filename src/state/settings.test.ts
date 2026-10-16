// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, useSettings } from './settings';

describe('settings', () => {
  beforeEach(() => {
    useSettings.setState({ ...DEFAULT_SETTINGS, loaded: false });
  });

  it('starts from the nebula defaults', () => {
    const s = useSettings.getState();
    expect(s.dimension).toBe('3d');
    expect(s.colorMode).toBe('cluster');
    expect(s.showUnresolved).toBe(true);
    expect(s.showOrphans).toBe(true);
    expect(s.showTags).toBe(false);
    expect(s.livePreview).toBe(true);
    expect(s.editorSize).toBe(16);
  });

  it('sets a value and toggles a boolean', () => {
    useSettings.getState().set('dimension', '2d');
    useSettings.getState().toggle('showTags');
    expect(useSettings.getState().dimension).toBe('2d');
    expect(useSettings.getState().showTags).toBe(true);
    useSettings.getState().toggle('showTags');
    expect(useSettings.getState().showTags).toBe(false);
  });
});

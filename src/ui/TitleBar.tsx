import { Orbit, PanelLeft, PanelRight, PenLine } from 'lucide-react';
import { runCommand } from '../commands';
import { useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { play } from './sounds';
import { IconButton, Kbd } from './primitives';

export function TitleBar() {
  const info = useVault((s) => s.info);
  const noteCount = useVault((s) => s.files.reduce((n, f) => n + (f.kind === 'note' ? 1 : 0), 0));
  const mode = useWorkspace((s) => s.mode);
  const leftOpen = useWorkspace((s) => s.leftOpen);
  const rightOpen = useWorkspace((s) => s.rightOpen);
  const { setMode, toggleLeft, toggleRight } = useWorkspace.getState();

  const switchTo = (m: 'write' | 'graph') => {
    if (m !== mode) play('whoosh');
    setMode(m);
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-vault" data-tauri-drag-region>
        <span className="vault-glyph" aria-hidden />
        <span className="vault-name" data-tauri-drag-region>
          {info?.name}
        </span>
        <span className="vault-count num" data-tauri-drag-region>
          {noteCount} notes
        </span>
      </div>

      <div className="mode-switch" role="tablist" aria-label="Mode" data-mode={mode}>
        <span className="mode-thumb" aria-hidden />
        <button type="button" role="tab" aria-selected={mode === 'write'} onClick={() => switchTo('write')}>
          <PenLine size={13} /> Write
        </button>
        <button type="button" role="tab" aria-selected={mode === 'graph'} onClick={() => switchTo('graph')}>
          <Orbit size={13} /> Graph
        </button>
      </div>

      <div className="titlebar-actions">
        <button type="button" className="command-button" onClick={() => runCommand('palette.open')}>
          Commands <Kbd>⌘K</Kbd>
        </button>
        {mode === 'write' && (
          <>
            <IconButton label={leftOpen ? 'Hide sidebar' : 'Show sidebar'} active={leftOpen} onClick={toggleLeft}>
              <PanelLeft size={15} />
            </IconButton>
            <IconButton label={rightOpen ? 'Hide links panel' : 'Show links panel'} active={rightOpen} onClick={toggleRight}>
              <PanelRight size={15} />
            </IconButton>
          </>
        )}
      </div>
    </header>
  );
}

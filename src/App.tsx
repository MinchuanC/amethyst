import { useEffect } from 'react';
import { api } from './api';
import { runCommand } from './commands';
import { flushEditor } from './editor/bridge';
import { installHotkeys } from './hotkeys';
import { useSettings, type Settings } from './state/settings';
import { useVault } from './state/vault';
import { useWorkspace } from './state/workspace';
import { Shell } from './ui/Shell';
import { Welcome } from './ui/Welcome';

/** Saves everything that is still in memory, then lets the app close. */
async function quit() {
  try {
    await flushEditor();
    if (useVault.getState().info) await useWorkspace.getState().persistNow();
  } finally {
    await api.quitApp();
  }
}

function applyTypography(s: Pick<Settings, 'editorSize' | 'readableWidth'>) {
  const root = document.documentElement.style;
  root.setProperty('--size-body', `${s.editorSize}px`);
  root.setProperty('--measure', s.readableWidth ? `${Math.round(s.editorSize * 46)}px` : 'none');
}

export function App() {
  const status = useVault((s) => s.status);
  const hasVault = useVault((s) => !!s.info);

  useEffect(() => {
    useVault.getState().init();
    const offKeys = installHotkeys();
    let offMenu: (() => void) | undefined;
    api
      .onMenu((id) => {
        if (id === 'app.quit') void quit();
        else runCommand(id);
      })
      .then((off) => (offMenu = off));
    applyTypography(useSettings.getState());
    const offSettings = useSettings.subscribe((s, prev) => {
      if (s.editorSize !== prev.editorSize || s.readableWidth !== prev.readableWidth) applyTypography(s);
    });
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      offKeys();
      offMenu?.();
      offSettings();
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  if (hasVault) return <Shell />;
  return <Welcome busy={status === 'opening'} />;
}

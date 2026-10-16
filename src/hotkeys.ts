import { runCommand } from './commands';

const BINDINGS: Record<string, string> = {
  'mod+k': 'palette.open',
  'mod+o': 'switcher.open',
  'mod+shift+f': 'search.open',
  'mod+n': 'note.new',
  'mod+e': 'note.reading',
  'mod+w': 'tab.close',
  'mod+g': 'mode.toggle',
  'mod+shift+d': 'graph.dimension',
  'mod+shift+r': 'graph.radar',
  'mod+shift+p': 'graph.path',
  'mod+shift+t': 'graph.timelapse',
  'mod+shift+o': 'vault.open',
  'mod+,': 'settings.open',
  'mod+[': 'nav.back',
  'mod+]': 'nav.forward',
  'mod+\\': 'view.left',
};

function comboOf(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  return parts.join('+');
}

export function installHotkeys() {
  const onKey = (e: KeyboardEvent) => {
    const id = BINDINGS[comboOf(e)];
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    runCommand(id);
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}

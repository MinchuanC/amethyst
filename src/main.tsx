import { createRoot } from 'react-dom/client';
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles/tokens.css';
import './styles/global.css';
import './styles/shell.css';
import './styles/sidebar.css';
import './styles/note.css';
import './styles/reading.css';
import './styles/links.css';
import './styles/overlays.css';
import './styles/hud.css';
import './styles/welcome.css';
import { App } from './App';

if (import.meta.env.DEV) {
  Promise.all([import('./state/workspace'), import('./state/settings'), import('./state/vault'), import('./api')]).then(
    ([workspace, settings, vault, api]) => {
      Object.assign(window, { __amethyst: { workspace: workspace.useWorkspace, settings: settings.useSettings, vault: vault.useVault, api: api.api } });
    },
  );
}

createRoot(document.getElementById('root')!).render(<App />);

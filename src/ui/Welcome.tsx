import { FolderOpen, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { api } from '../api';
import { createMockBackend } from '../api/mock';
import { GraphEngine } from '../graph/engine/GraphEngine';
import { buildView, GraphModel } from '../graph/model';
import { useVault } from '../state/vault';
import { formatDate } from './primitives';

/** The sample vault's own sky, orbiting behind the welcome text. */
function WelcomeSky() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let engine: GraphEngine;
    try {
      engine = new GraphEngine(ref.current!, { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    } catch {
      return;
    }
    engine.setAmbient(true);
    engine.setBloom(1.1);
    engine.setViewShift(0.2);
    let cancelled = false;
    const sample = createMockBackend();
    sample
      .openVault('sample')
      .then(() => sample.graphSnapshot())
      .then((snap) => {
        if (cancelled) return;
        const model = new GraphModel();
        model.load(snap);
        engine.setGraph(
          buildView(model, { showTags: false, showAttachments: false, showUnresolved: true, showOrphans: true, showGhostLinks: false }),
        );
      });
    return () => {
      cancelled = true;
      engine.dispose();
    };
  }, []);
  return <div className="welcome-sky" ref={ref} aria-hidden />;
}

export function Welcome({ busy }: { busy: boolean }) {
  const recent = useVault((s) => s.recent);
  const error = useVault((s) => s.error);
  const { pickAndOpen, open, removeRecent } = useVault.getState();

  const openSample = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('install_sample_vault');
      await open(path);
    } catch (e) {
      useVault.setState({ error: String(e) });
    }
  };

  return (
    <main className="welcome">
      <WelcomeSky />
      <div className="welcome-drag" data-tauri-drag-region />
      <section className="welcome-copy" aria-labelledby="welcome-title">
        <h1 id="welcome-title" className="welcome-title">
          Amethyst
        </h1>
        <p className="welcome-lede">Your notes as a sky you can fly through. Open any folder of markdown files; Obsidian vaults work as they are.</p>
        <div className="welcome-actions">
          <button type="button" className="button button-primary button-large" onClick={pickAndOpen} disabled={busy}>
            <FolderOpen size={16} aria-hidden /> {busy ? 'Opening…' : 'Open a vault folder'}
          </button>
          {api.isNative && (
            <button type="button" className="button button-large" onClick={openSample} disabled={busy}>
              Explore the sample vault
            </button>
          )}
        </div>
        {error && (
          <p className="welcome-error" role="alert">
            Couldn’t open that folder: {error.replace(/^Error:\s*/, '')}
          </p>
        )}
        {recent.length > 0 && (
          <div className="welcome-recent">
            <h2>Recent vaults</h2>
            <ul>
              {recent.map((r) => (
                <li key={r.path}>
                  <button type="button" className="recent-item" onClick={() => open(r.path)} disabled={busy}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-path">{r.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                    <span className="recent-date">{formatDate(r.lastOpened)}</span>
                  </button>
                  <button type="button" className="recent-remove" aria-label={`Remove ${r.name} from recent vaults`} onClick={() => removeRecent(r.path)}>
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="welcome-foot">Everything stays on this Mac. No account, no sync server.</p>
      </section>
    </main>
  );
}

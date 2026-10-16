import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { reportError } from '../actions';
import { api } from '../api';
import { useSettings, type Settings } from '../state/settings';
import { useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { useFocusTrap } from './useFocusTrap';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function Switch({ setting, label, hint }: { setting: BoolKey; label: string; hint: string }) {
  const on = useSettings((s) => s[setting]);
  const id = `setting-${setting}`;
  return (
    <div className="setting-row">
      <div className="setting-text">
        <label htmlFor={id}>{label}</label>
        <p>{hint}</p>
      </div>
      <button id={id} type="button" role="switch" aria-checked={on} className="switch" onClick={() => useSettings.getState().toggle(setting)}>
        <span />
      </button>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented setting-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsDialog() {
  const s = useSettings();
  const info = useVault((v) => v.info);
  const close = () => useWorkspace.getState().setOverlay(null);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="overlay-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} className="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-head">
          <h2 id="settings-title" className="dialog-title">
            Settings
          </h2>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={close} autoFocus>
            <X size={15} />
          </button>
        </header>

        <div className="settings-scroll">
          <section className="settings-section" aria-labelledby="settings-editor">
            <h3 id="settings-editor">Writing</h3>
            <Switch setting="livePreview" label="Live preview" hint="Hide Markdown symbols on lines you aren’t editing." />
            <Switch setting="spellcheck" label="Check spelling" hint="Underline misspelled words as you type." />
            <Switch setting="readableWidth" label="Readable line length" hint="Keep lines near 70 characters, however wide the window is." />
            <Row label="Text size">
              <Choice
                label="Text size"
                value={s.editorSize}
                options={[14, 16, 18, 20].map((n) => ({ id: n as Settings['editorSize'], label: `${n}` }))}
                onChange={(v) => s.set('editorSize', v)}
              />
            </Row>
          </section>

          <section className="settings-section" aria-labelledby="settings-graph">
            <h3 id="settings-graph">Graph</h3>
            <Row label="Open the graph in">
              <Choice
                label="Graph dimensions"
                value={s.dimension}
                options={[
                  { id: '3d', label: '3D' },
                  { id: '2d', label: '2D' },
                ]}
                onChange={(v) => s.set('dimension', v)}
              />
            </Row>
            <Row label="Glow" hint="How strongly stars and links bloom.">
              <input
                className="setting-range"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={s.bloom}
                aria-label="Glow strength"
                onChange={(e) => s.set('bloom', Number(e.target.value))}
              />
            </Row>
            <Switch setting="linkFlow" label="Animate link flow" hint="Light travels along each link toward the note it points to." />
            <Switch setting="groupClusters" label="Pull clusters together" hint="Notes in the same constellation drift closer." />
            <Switch setting="sounds" label="Interface sounds" hint="Soft tones when you hover, select, and switch modes." />
          </section>

          {info && (
            <section className="settings-section" aria-labelledby="settings-vault">
              <h3 id="settings-vault">Vault</h3>
              <Row label={info.name} hint={info.root.replace(/^\/Users\/[^/]+/, '~')}>
                {api.isNative && (
                  <div className="setting-actions">
                    <button type="button" className="button" onClick={() => api.revealVault().catch(reportError)}>
                      Show in Finder
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        close();
                        useVault.getState().pickAndOpen();
                      }}
                    >
                      Open another…
                    </button>
                  </div>
                )}
              </Row>
            </section>
          )}
        </div>
        <p className="settings-foot">Amethyst 0.1.0. Everything stays on this Mac.</p>
      </div>
    </div>
  );
}

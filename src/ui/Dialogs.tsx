import { useRef, useState } from 'react';
import { useWorkspace, type Overlay } from '../state/workspace';
import { useFocusTrap } from './useFocusTrap';

type PromptOverlay = Extract<Overlay, { kind: 'prompt' }>;
type ConfirmOverlay = Extract<Overlay, { kind: 'confirm' }>;

const close = () => useWorkspace.getState().setOverlay(null);

export function PromptDialog({ overlay }: { overlay: PromptOverlay }) {
  const [value, setValue] = useState(overlay.initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useFocusTrap(ref);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    await overlay.onSubmit(value.trim());
    close();
  };
  return (
    <div className="overlay-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-hint"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2 id="dialog-title" className="dialog-title">
          {overlay.title}
        </h2>
        <label className="dialog-label">
          <span id="dialog-hint">{overlay.label}</span>
          <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} spellCheck={false} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={!value.trim() || busy}>
            {overlay.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ConfirmDialog({ overlay }: { overlay: ConfirmOverlay }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div className="overlay-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={ref}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-body"
        onKeyDown={(e) => e.key === 'Escape' && close()}
      >
        <h2 id="dialog-title" className="dialog-title">
          {overlay.title}
        </h2>
        <p id="dialog-body" className="dialog-body">
          {overlay.body}
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={close} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className={`button ${overlay.danger ? 'button-danger' : 'button-primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await overlay.onConfirm();
              close();
            }}
          >
            {overlay.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useWorkspace((s) => s.toasts);
  const dismiss = useWorkspace((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button type="button" key={t.id} className={`toast tone-${t.tone}`} onClick={() => dismiss(t.id)} title="Dismiss">
          {t.text}
        </button>
      ))}
    </div>
  );
}

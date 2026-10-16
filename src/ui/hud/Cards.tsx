import { X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { openNode } from '../../actions';
import { UNRESOLVED_PREFIX } from '../../api';
import { TAG_PREFIX } from '../../graph/model';
import { useGraphHover } from '../../state/graphHover';
import { useGraphInfo } from '../../state/graphInfo';
import { useSettings } from '../../state/settings';
import { graphModel, useVault } from '../../state/vault';
import { useWorkspace } from '../../state/workspace';
import { formatDate } from '../primitives';

function useNodeFacts(id: string | null) {
  const version = useVault((s) => s.graphVersion);
  return useMemo(() => {
    if (!id) return null;
    const node = graphModel.nodes.get(id);
    let out = 0;
    let back = 0;
    for (const e of graphModel.edges.values()) {
      if (e.source === id) out++;
      if (e.target === id) back++;
    }
    if (!node && id.startsWith(TAG_PREFIX)) {
      const tag = id.slice(TAG_PREFIX.length);
      let count = 0;
      for (const n of graphModel.nodes.values()) if (n.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`))) count++;
      return { title: `#${tag}`, folder: '', kind: 'tag' as const, created: 0, out: 0, back: count, tags: [] as string[] };
    }
    if (!node) return null;
    return { title: node.title, folder: node.folder, kind: node.kind, created: node.created, out, back, tags: node.tags };
  }, [id, version]);
}

export function HoverCard() {
  const id = useGraphHover((s) => s.id);
  const x = useGraphHover((s) => s.x);
  const y = useGraphHover((s) => s.y);
  const facts = useNodeFacts(id);
  const cluster = useGraphInfo((s) => {
    const c = id ? s.clusters.get(id) : undefined;
    return c != null && c >= 0 ? s.clusterList[c] : undefined;
  });
  if (!id || !facts) return null;
  const left = Math.min(x + 18, window.innerWidth - 280);
  const top = Math.min(y + 18, window.innerHeight - 150);
  return (
    <div className="hover-card" style={{ left, top }} role="tooltip">
      <p className="hover-title">{facts.title}</p>
      {facts.kind === 'unresolved' ? (
        <p className="hover-line">Not written yet. Linked from {facts.back} note{facts.back === 1 ? '' : 's'}.</p>
      ) : facts.kind === 'tag' ? (
        <p className="hover-line num">{facts.back} notes carry this tag</p>
      ) : (
        <>
          <p className="hover-line">{facts.folder || 'Vault root'}</p>
          <p className="hover-line num">
            {facts.out} out, {facts.back} in
            {cluster && (
              <span className="hover-cluster">
                <i style={{ background: cluster.color }} aria-hidden /> {cluster.label}
              </span>
            )}
          </p>
        </>
      )}
      <p className="hover-hint">{facts.kind === 'unresolved' ? 'Double-click to create it' : 'Click to focus, double-click to open'}</p>
    </div>
  );
}

export function FocusCard() {
  const focusId = useWorkspace((s) => s.focusId);
  const mode = useWorkspace((s) => s.mode);
  const depth = useSettings((s) => s.focusDepth);
  const facts = useNodeFacts(focusId);
  const ws = useWorkspace.getState();

  useEffect(() => {
    if (mode !== 'graph') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || useWorkspace.getState().overlay) return;
      const w = useWorkspace.getState();
      if (w.hud.path) w.toggleHud('path', false);
      else if (w.highlight) w.setHighlight(null);
      else w.setFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  if (!focusId || !facts) return null;
  const isNote = !focusId.startsWith(UNRESOLVED_PREFIX) && !focusId.startsWith(TAG_PREFIX);

  return (
    <section className="focus-card hud-surface hud-brackets" aria-label="Focused note">
      <button type="button" className="focus-close" aria-label="Clear focus (Esc)" onClick={() => ws.setFocus(null)}>
        <X size={14} />
      </button>
      <p className="focus-folder hud-caption">{facts.kind === 'unresolved' ? 'Not written yet' : facts.folder || 'Vault root'}</p>
      <h2 className="focus-title">{facts.title}</h2>
      <dl className="focus-facts num">
        {facts.created > 0 && (
          <div>
            <dt>Created</dt>
            <dd>{formatDate(facts.created)}</dd>
          </div>
        )}
        <div>
          <dt>Links out</dt>
          <dd>{facts.out}</dd>
        </div>
        <div>
          <dt>{facts.kind === 'tag' ? 'Notes' : 'Backlinks'}</dt>
          <dd>{facts.back}</dd>
        </div>
      </dl>
      <div className="focus-depth">
        <span>Light up</span>
        <div className="segmented" role="radiogroup" aria-label="How far to light up neighbours">
          {([1, 2, 3] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={depth === d} onClick={() => useSettings.getState().set('focusDepth', d)}>
              {d} {d === 1 ? 'link' : 'links'}
            </button>
          ))}
        </div>
      </div>
      <div className="focus-actions">
        <button type="button" className="button button-primary" onClick={() => openNode(focusId)}>
          {isNote ? 'Open note' : facts.kind === 'tag' ? 'List these notes' : 'Create this note'}
        </button>
        {isNote && (
          <button
            type="button"
            className="button"
            onClick={() => {
              ws.toggleHud('path', true);
              ws.setPath({ from: focusId, to: null, result: null, searched: false });
            }}
          >
            Find a path from here
          </button>
        )}
      </div>
    </section>
  );
}

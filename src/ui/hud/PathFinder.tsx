import { ArrowDownUp, X } from 'lucide-react';
import { useEffect } from 'react';
import { getEngine } from '../../graph/GraphView';
import { graphModel } from '../../state/vault';
import { useWorkspace } from '../../state/workspace';
import { play } from '../sounds';
import { NotePicker } from './NotePicker';

export function PathFinder() {
  const path = useWorkspace((s) => s.path);
  const ws = useWorkspace.getState();

  const trace = (from: string | null, to: string | null) => {
    if (!from || !to) return;
    const result = getEngine()?.findPath(from, to) ?? null;
    ws.setPath({ result, searched: true });
    if (result) play('focus');
  };

  useEffect(() => {
    if (path.from && path.to && !path.searched) trace(path.from, path.to);
  }, [path.from, path.to, path.searched]);

  const steps = path.result ?? [];
  return (
    <aside className="hud-panel pathfinder hud-surface hud-brackets" aria-label="Find a path">
      <header className="hud-panel-head">
        <div>
          <p className="hud-caption">Route finder</p>
          <h2>Find a path</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close path finder" onClick={() => ws.toggleHud('path', false)}>
          <X size={15} />
        </button>
      </header>
      <p className="hud-panel-lede">The shortest chain of links between two notes. You can also shift-click two notes in the graph.</p>
      <div className="path-fields">
        <NotePicker label="From" value={path.from} onChange={(id) => ws.setPath({ from: id, result: null, searched: false })} />
        <button
          type="button"
          className="icon-button path-swap"
          aria-label="Swap the two notes"
          onClick={() => ws.setPath({ from: path.to, to: path.from, result: null, searched: false })}
        >
          <ArrowDownUp size={14} />
        </button>
        <NotePicker label="To" value={path.to} onChange={(id) => ws.setPath({ to: id, result: null, searched: false })} />
      </div>
      {path.searched && !path.result && <p className="path-none">No chain of links connects these two notes.</p>}
      {steps.length > 0 && (
        <>
          <p className="path-summary">
            {steps.length - 1} link{steps.length === 2 ? '' : 's'} apart
          </p>
          <ol className="path-steps">
            {steps.map((id) => (
              <li key={id}>
                <button type="button" onClick={() => ws.setFocus(id)}>
                  {graphModel.nodes.get(id)?.title ?? id}
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}

import { Crosshair } from 'lucide-react';
import { useMemo } from 'react';
import { graphModel, useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { IconButton } from './primitives';

interface TagRow {
  tag: string;
  depth: number;
  count: number;
  ids: string[];
}

export function TagsPane() {
  const graphVersion = useVault((s) => s.graphVersion);
  const rows = useMemo(() => {
    const byTag = new Map<string, { display: string; ids: Set<string> }>();
    for (const n of graphModel.nodes.values()) {
      if (n.kind !== 'note') continue;
      for (const tag of n.tags) {
        const parts = tag.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const t = parts.slice(0, i).join('/');
          const key = t.toLowerCase();
          const entry = byTag.get(key) ?? { display: t, ids: new Set() };
          entry.ids.add(n.id);
          byTag.set(key, entry);
        }
      }
    }
    const out: TagRow[] = [...byTag.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ tag: v.display, depth: v.display.split('/').length - 1, count: v.ids.size, ids: [...v.ids] }));
    return out;
  }, [graphVersion]);

  const ws = useWorkspace.getState();
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="tags-pane">
      <div className="pane-head">
        <span className="pane-meta num">
          {rows.length} tag{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="tags-scroll">
        {rows.map((r) => (
          <div className="tag-row" key={r.tag} style={{ paddingLeft: 12 + r.depth * 14 }}>
            <button
              type="button"
              className="tag-name"
              onClick={() => {
                ws.setSearchQuery(`#${r.tag}`);
                ws.setLeftTab('search');
              }}
            >
              <span className="tag-hash">#</span>
              {r.tag.split('/').pop()}
            </button>
            <span className="tag-bar" style={{ width: `${(r.count / max) * 44}px` }} aria-hidden />
            <span className="tag-count num">{r.count}</span>
            <IconButton
              label={`Show notes tagged #${r.tag} in the graph`}
              className="tag-locate"
              onClick={() => {
                ws.setHighlight({ ids: r.ids, label: `#${r.tag}` });
                ws.setMode('graph');
              }}
            >
              <Crosshair size={13} />
            </IconButton>
          </div>
        ))}
        {rows.length === 0 && <p className="pane-empty">No tags yet. Add #tags in notes or frontmatter.</p>}
      </div>
    </div>
  );
}

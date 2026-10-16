import { Crosshair, History, Radar as RadarIcon, Route, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { bus } from '../../bus';
import { ageColor } from '../../graph/colors';
import { useGraphInfo } from '../../state/graphInfo';
import { useSettings, type ColorMode } from '../../state/settings';
import { graphModel, useVault } from '../../state/vault';
import { useWorkspace } from '../../state/workspace';
import { FocusCard, HoverCard } from './Cards';
import { PathFinder } from './PathFinder';
import { Radar } from './Radar';
import { Timelapse } from './Timelapse';

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'cluster', label: 'Cluster' },
  { id: 'folder', label: 'Folder' },
  { id: 'tag', label: 'Tag' },
  { id: 'age', label: 'Age' },
];

export function GraphHud() {
  const hud = useWorkspace((s) => s.hud);
  const highlight = useWorkspace((s) => s.highlight);
  return (
    <div className="hud" aria-label="Graph controls">
      <ControlDock />
      <Legend />
      <Readout />
      <HoverCard />
      {!hud.path && <FocusCard />}
      {hud.radar && <Radar />}
      {hud.path && <PathFinder />}
      {hud.timelapse && <Timelapse />}
      {highlight && (
        <div className="hud-highlight">
          Showing {highlight.ids.length} notes for {highlight.label}
          <button type="button" onClick={() => useWorkspace.getState().setHighlight(null)}>
            Clear
          </button>
        </div>
      )}
      <FeatureBar />
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ControlDock() {
  const s = useSettings();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const toggles: { key: 'showTags' | 'showAttachments' | 'showOrphans' | 'showUnresolved' | 'showGhostLinks' | 'groupClusters' | 'linkFlow'; label: string }[] = [
    { key: 'showUnresolved', label: 'Notes that don’t exist yet' },
    { key: 'showOrphans', label: 'Notes with no links' },
    { key: 'showTags', label: 'Tags' },
    { key: 'showAttachments', label: 'Attachments' },
    { key: 'showGhostLinks', label: 'Similar-note ghost links' },
    { key: 'groupClusters', label: 'Pull clusters together' },
    { key: 'linkFlow', label: 'Animate link flow' },
  ];
  return (
    <div className="hud-dock">
      <Segmented
        label="Dimensions"
        value={s.dimension}
        options={[
          { id: '3d', label: '3D' },
          { id: '2d', label: '2D' },
        ]}
        onChange={(v) => s.set('dimension', v)}
      />
      <Segmented label="Color notes by" value={s.colorMode} options={COLOR_MODES} onChange={(v) => s.set('colorMode', v)} />
      <div className="hud-filters">
        <button type="button" className="hud-chip" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          <SlidersHorizontal size={14} aria-hidden /> Show
        </button>
        {filtersOpen && (
          <div className="hud-popover" role="group" aria-label="What the graph shows">
            {toggles.map((t) => (
              <label key={t.key} className="hud-toggle">
                <input
                  type="checkbox"
                  checked={s[t.key]}
                  onChange={() => {
                    s.toggle(t.key);
                    if (t.key === 'showGhostLinks' && !s.showGhostLinks) useVault.getState().loadGhostLinks();
                  }}
                />
                <span>{t.label}</span>
              </label>
            ))}
            <label className="hud-range">
              <span>Glow</span>
              <input type="range" min={0} max={2} step={0.05} value={s.bloom} onChange={(e) => s.set('bloom', Number(e.target.value))} />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureBar() {
  const hud = useWorkspace((s) => s.hud);
  const ws = useWorkspace.getState();
  return (
    <nav className="hud-bar" aria-label="Graph tools">
      <button type="button" aria-pressed={hud.radar} onClick={() => ws.toggleHud('radar')}>
        <RadarIcon size={15} aria-hidden /> Vault Radar
      </button>
      <button
        type="button"
        aria-pressed={hud.path}
        onClick={() => {
          ws.toggleHud('path');
          if (!hud.path && ws.focusId) ws.setPath({ from: ws.focusId });
        }}
      >
        <Route size={15} aria-hidden /> Find a path
      </button>
      <button type="button" aria-pressed={hud.timelapse} onClick={() => ws.toggleHud('timelapse')}>
        <History size={15} aria-hidden /> Time-lapse
      </button>
      <button type="button" onClick={() => bus.emit('graph:recenter')}>
        <Crosshair size={15} aria-hidden /> Recenter
      </button>
    </nav>
  );
}

function Legend() {
  const mode = useSettings((s) => s.colorMode);
  const clusters = useGraphInfo((s) => s.clusterList);
  const colors = useGraphInfo((s) => s.colors);
  const structure = useVault((s) => s.structureVersion);

  const items = useMemo(() => {
    if (mode === 'cluster') return clusters.slice(0, 8).map((c) => ({ key: String(c.index), label: c.label, count: c.size, color: c.color }));
    if (mode === 'age') return [];
    const groups = new Map<string, { count: number; color: string }>();
    for (const n of graphModel.nodes.values()) {
      if (n.kind !== 'note') continue;
      const key = mode === 'folder' ? n.folder.split('/')[0] || 'Vault root' : n.tags[0]?.split('/')[0] ?? 'Untagged';
      const g = groups.get(key) ?? { count: 0, color: colors.get(n.id) ?? '#8a83a3' };
      g.count++;
      groups.set(key, g);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([label, g]) => ({ key: label, label: mode === 'tag' && label !== 'Untagged' ? `#${label}` : label, count: g.count, color: g.color }));
  }, [mode, clusters, colors, structure]);

  return (
    <div className="hud-legend" aria-label="Legend">
      <p className="hud-legend-title hud-caption">{mode === 'cluster' ? 'Constellations' : mode === 'folder' ? 'Folders' : mode === 'tag' ? 'Tags' : 'Note age'}</p>
      {mode === 'age' ? (
        <div className="legend-age">
          <span className="age-swatch" aria-hidden>
            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
              <i key={t} style={{ background: ageColor(t) }} />
            ))}
          </span>
          <div className="age-labels">
            <span>Oldest</span>
            <span>Newest</span>
          </div>
        </div>
      ) : (
        <ul>
          {items.map((i) => (
            <li key={i.key}>
              <i style={{ background: i.color, color: i.color }} aria-hidden />
              <span className="legend-label">{i.label}</span>
              <span className="legend-count num">{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Readout() {
  const version = useVault((s) => s.graphVersion);
  const fps = useGraphInfo((s) => s.fps);
  const counts = useMemo(() => {
    let notes = 0;
    let links = 0;
    for (const n of graphModel.nodes.values()) if (n.kind === 'note') notes++;
    for (const e of graphModel.edges.values()) links += e.count;
    return { notes, links };
  }, [version]);
  return (
    <div className="hud-readout hud-caption" aria-label="Graph statistics">
      <span>
        <b>{counts.notes}</b> notes
      </span>
      <span>
        <b>{counts.links}</b> links
      </span>
      <span>
        <b>{fps}</b> fps
      </span>
    </div>
  );
}

import { X } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { pagerank } from '../../graph/analysis';
import { useGraphInfo } from '../../state/graphInfo';
import { useSettings } from '../../state/settings';
import { graphModel, useVault } from '../../state/vault';
import { useWorkspace } from '../../state/workspace';
import { RadarScope } from './RadarScope';

interface Stats {
  notes: number;
  links: number;
  missing: { id: string; title: string; refs: number }[];
  orphans: { id: string; title: string }[];
  hubs: { id: string; title: string; score: number }[];
  tags: number;
  attachments: number;
}

function computeStats(): Stats {
  const ids: string[] = [];
  const index = new Map<string, number>();
  let notes = 0;
  let attachments = 0;
  const tags = new Set<string>();
  for (const n of graphModel.nodes.values()) {
    if (n.kind === 'note') {
      notes++;
      n.tags.forEach((t) => tags.add(t.toLowerCase()));
    }
    if (n.kind === 'attachment') attachments++;
    index.set(n.id, ids.length);
    ids.push(n.id);
  }
  const degree = new Map<string, number>();
  const refs = new Map<string, number>();
  const src: number[] = [];
  const dst: number[] = [];
  let links = 0;
  for (const e of graphModel.edges.values()) {
    links += e.count;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    if (e.target.startsWith('unresolved:')) refs.set(e.target, (refs.get(e.target) ?? 0) + 1);
    else if (graphModel.nodes.get(e.target)?.kind === 'note') {
      src.push(index.get(e.source)!);
      dst.push(index.get(e.target)!);
    }
  }
  const pr = pagerank(ids.length, src, dst);
  const notesOnly = ids.map((id, i) => ({ id, i })).filter(({ id }) => graphModel.nodes.get(id)?.kind === 'note');
  const hubs = notesOnly
    .sort((a, b) => pr[b.i] - pr[a.i])
    .slice(0, 7)
    .map(({ id, i }) => ({ id, title: graphModel.nodes.get(id)!.title, score: pr[i] }));
  const missing = [...refs.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, title: graphModel.nodes.get(id)?.title ?? id, refs: count }));
  const orphans = notesOnly
    .filter(({ id }) => !degree.get(id))
    .map(({ id }) => ({ id, title: graphModel.nodes.get(id)!.title }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { notes, links, missing, orphans, hubs, tags: tags.size, attachments };
}

export function Radar() {
  const version = useVault((s) => s.structureVersion);
  const clusters = useGraphInfo((s) => s.clusterList);
  const stats = useMemo(computeStats, [version]);
  const ws = useWorkspace.getState();
  const settings = useSettings.getState();
  const clustered = clusters.reduce((n, c) => n + c.size, 0);
  const topScore = stats.hubs[0]?.score ?? 1;

  const look = (id: string) => {
    if (id.startsWith('unresolved:') && !settings.showUnresolved) settings.set('showUnresolved', true);
    if (stats.orphans.some((o) => o.id === id) && !settings.showOrphans) settings.set('showOrphans', true);
    ws.setFocus(id);
  };

  return (
    <aside className="hud-panel radar hud-surface hud-brackets" aria-label="Vault Radar">
      <header className="hud-panel-head">
        <div>
          <p className="hud-caption">Scan complete</p>
          <h2>Vault Radar</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close Vault Radar" onClick={() => ws.toggleHud('radar', false)}>
          <X size={15} />
        </button>
      </header>
      <RadarScope clusters={clusters} orphans={stats.orphans.length} missing={stats.missing.length} />

      <div className="radar-figures num">
        <Figure value={stats.notes} label="notes" />
        <Figure value={stats.links} label="links" />
        <Figure value={clusters.length} label="constellations" />
        <Figure value={stats.missing.length} label="missing notes" tone={stats.missing.length ? 'warn' : undefined} />
        <Figure value={stats.orphans.length} label="unlinked notes" tone={stats.orphans.length ? 'warn' : undefined} />
        <Figure value={stats.tags} label="tags" />
      </div>

      {clusters.length > 0 && (
        <RadarSection title="Constellations" note={`${clustered} of ${stats.notes} notes belong to one`}>
          <div className="cluster-strip" aria-hidden>
            {clusters.map((c) => (
              <i key={c.index} style={{ flexGrow: c.size, background: c.color }} />
            ))}
          </div>
          <ul className="radar-list">
            {clusters.slice(0, 6).map((c) => (
              <li key={c.index}>
                <button
                  type="button"
                  onClick={() => {
                    const ids = [...useGraphInfo.getState().clusters.entries()].filter(([, v]) => v === c.index).map(([k]) => k);
                    ws.setHighlight({ ids, label: `the ${c.label} constellation` });
                  }}
                >
                  <i className="dot" style={{ background: c.color }} aria-hidden />
                  <span className="radar-name">{c.label}</span>
                  <span className="radar-value num">{c.size}</span>
                </button>
              </li>
            ))}
          </ul>
        </RadarSection>
      )}

      <RadarSection title="Hubs" note="Ranked by PageRank: notes that well-linked notes point to">
        <ul className="radar-list">
          {stats.hubs.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => look(h.id)}>
                <span className="radar-name">{h.title}</span>
                <span className="radar-bar" aria-hidden>
                  <i style={{ width: `${(h.score / topScore) * 100}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </RadarSection>

      <RadarSection title="Links to missing notes" note={stats.missing.length ? 'Click one to see who links to it' : 'Every link points to a real note'}>
        <ul className="radar-list">
          {stats.missing.slice(0, 8).map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => look(m.id)}>
                <span className="radar-name is-missing">{m.title}</span>
                <span className="radar-value num">{m.refs}</span>
              </button>
            </li>
          ))}
        </ul>
      </RadarSection>

      <RadarSection title="Unlinked notes" note={stats.orphans.length ? 'Nothing links in or out' : 'Every note has at least one link'}>
        <ul className="radar-list">
          {stats.orphans.slice(0, 8).map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => look(o.id)}>
                <span className="radar-name">{o.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </RadarSection>
    </aside>
  );
}

function Figure({ value, label, tone }: { value: number; label: string; tone?: 'warn' }) {
  return (
    <div className={`figure ${tone ? `tone-${tone}` : ''}`}>
      <b>{value.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}

function RadarSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="radar-section">
      <h3>{title}</h3>
      {note && <p className="radar-note">{note}</p>}
      {children}
    </section>
  );
}

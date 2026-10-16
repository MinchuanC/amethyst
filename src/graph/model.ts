import type { GhostLink, GraphDelta, GraphEdge, GraphNode, GraphSnapshot } from '../api/types';

export type ViewNodeKind = 'note' | 'attachment' | 'unresolved' | 'tag';
export type ViewEdgeKind = 'link' | 'embed' | 'tag' | 'ghost';

export interface ViewNode {
  id: string;
  title: string;
  kind: ViewNodeKind;
  folder: string;
  tags: string[];
  created: number;
  modified: number;
  degree: number;
}

export interface ViewEdge {
  id: string;
  source: string;
  target: string;
  kind: ViewEdgeKind;
}

export interface ViewGraph {
  nodes: ViewNode[];
  edges: ViewEdge[];
}

export interface ViewFilters {
  showTags: boolean;
  showAttachments: boolean;
  showUnresolved: boolean;
  showOrphans: boolean;
  showGhostLinks: boolean;
}

export interface DeltaSummary {
  changedNodes: string[];
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: string[];
}

export const TAG_PREFIX = 'tag:';

/** Mirror of the backend graph, kept in sync with snapshots and deltas. */
export class GraphModel {
  nodes = new Map<string, GraphNode>();
  edges = new Map<string, GraphEdge>();

  load(snapshot: GraphSnapshot) {
    this.nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
    this.edges = new Map(snapshot.edges.map((e) => [e.id, e]));
  }

  applyDelta(delta: GraphDelta): DeltaSummary {
    const summary: DeltaSummary = { changedNodes: [], addedNodes: [], removedNodes: [], addedEdges: [] };
    for (const id of delta.removeEdges) this.edges.delete(id);
    for (const id of delta.removeNodes) {
      if (this.nodes.delete(id)) summary.removedNodes.push(id);
    }
    for (const n of delta.upsertNodes) {
      (this.nodes.has(n.id) ? summary.changedNodes : summary.addedNodes).push(n.id);
      this.nodes.set(n.id, n);
    }
    for (const e of delta.upsertEdges) {
      if (!this.edges.has(e.id)) summary.addedEdges.push(e.id);
      this.edges.set(e.id, e);
    }
    return summary;
  }

  degrees(): Map<string, number> {
    const deg = new Map<string, number>();
    for (const e of this.edges.values()) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    return deg;
  }
}

/** Applies the user's graph filters and derives tag and ghost-link layers. */
export function buildView(model: GraphModel, filters: ViewFilters, ghosts: GhostLink[] = []): ViewGraph {
  const include = new Map<string, ViewNode>();
  for (const n of model.nodes.values()) {
    if (n.kind === 'attachment' && !filters.showAttachments) continue;
    if (n.kind === 'unresolved' && !filters.showUnresolved) continue;
    include.set(n.id, { id: n.id, title: n.title, kind: n.kind, folder: n.folder, tags: n.tags, created: n.created, modified: n.modified, degree: 0 });
  }
  const edges: ViewEdge[] = [];
  for (const e of model.edges.values()) {
    if (include.has(e.source) && include.has(e.target)) edges.push({ id: e.id, source: e.source, target: e.target, kind: e.kind });
  }
  if (filters.showTags) {
    const tagNodes = new Map<string, ViewNode>();
    const ensureTag = (tag: string, created: number) => {
      const id = TAG_PREFIX + tag.toLowerCase();
      const existing = tagNodes.get(id);
      if (existing) {
        existing.created = Math.min(existing.created, created);
        return id;
      }
      tagNodes.set(id, { id, title: `#${tag}`, kind: 'tag', folder: '', tags: [], created, modified: 0, degree: 0 });
      const slash = tag.lastIndexOf('/');
      if (slash > 0) {
        const parent = ensureTag(tag.slice(0, slash), created);
        edges.push({ id: `${id}\u001f${parent}`, source: id, target: parent, kind: 'tag' });
      }
      return id;
    };
    for (const n of include.values()) {
      if (n.kind !== 'note') continue;
      for (const tag of n.tags) {
        const id = ensureTag(tag, n.created);
        edges.push({ id: `${n.id}\u001f${id}`, source: n.id, target: id, kind: 'tag' });
      }
    }
    for (const [id, n] of tagNodes) include.set(id, n);
  }
  if (filters.showGhostLinks) {
    for (const g of ghosts) {
      if (include.has(g.source) && include.has(g.target)) {
        edges.push({ id: `ghost:${g.source}\u001f${g.target}`, source: g.source, target: g.target, kind: 'ghost' });
      }
    }
  }
  for (const e of edges) {
    if (e.kind === 'ghost') continue;
    include.get(e.source)!.degree++;
    include.get(e.target)!.degree++;
  }
  let nodes = [...include.values()];
  if (!filters.showOrphans) {
    nodes = nodes.filter((n) => n.degree > 0);
  }
  return { nodes, edges };
}

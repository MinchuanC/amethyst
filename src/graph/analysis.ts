import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import pagerankFn from 'graphology-metrics/centrality/pagerank';

/** Undirected adjacency in compressed sparse row form. */
export interface Adjacency {
  offsets: Int32Array;
  neighbors: Int32Array;
}

export function buildAdjacency(n: number, src: ArrayLike<number>, dst: ArrayLike<number>, include?: (edge: number) => boolean): Adjacency {
  const counts = new Int32Array(n + 1);
  const m = src.length;
  for (let e = 0; e < m; e++) {
    if (include && !include(e)) continue;
    if (src[e] === dst[e]) continue;
    counts[src[e] + 1]++;
    counts[dst[e] + 1]++;
  }
  for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
  const offsets = counts.slice();
  const fill = counts.slice(0, n);
  const neighbors = new Int32Array(offsets[n]);
  for (let e = 0; e < m; e++) {
    if (include && !include(e)) continue;
    const a = src[e];
    const b = dst[e];
    if (a === b) continue;
    neighbors[fill[a]++] = b;
    neighbors[fill[b]++] = a;
  }
  return { offsets, neighbors };
}

export function degreeOf(adj: Adjacency, i: number) {
  return adj.offsets[i + 1] - adj.offsets[i];
}

/** Hop distance from `start` for every node, up to `maxDepth`; -1 when farther or unreachable. */
export function bfsHops(adj: Adjacency, start: number, maxDepth: number): Int16Array {
  const n = adj.offsets.length - 1;
  const hops = new Int16Array(n).fill(-1);
  if (start < 0 || start >= n) return hops;
  hops[start] = 0;
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: number[] = [];
    for (const u of frontier) {
      for (let k = adj.offsets[u]; k < adj.offsets[u + 1]; k++) {
        const v = adj.neighbors[k];
        if (hops[v] === -1) {
          hops[v] = depth;
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return hops;
}

/** Shortest chain of links between two nodes (undirected), or null. */
export function shortestPath(adj: Adjacency, from: number, to: number): number[] | null {
  const n = adj.offsets.length - 1;
  if (from < 0 || to < 0 || from >= n || to >= n) return null;
  if (from === to) return [from];
  const prev = new Int32Array(n).fill(-1);
  prev[from] = from;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  while (head < tail) {
    const u = queue[head++];
    for (let k = adj.offsets[u]; k < adj.offsets[u + 1]; k++) {
      const v = adj.neighbors[k];
      if (prev[v] !== -1) continue;
      prev[v] = u;
      if (v === to) {
        const path = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev[cur];
          path.push(cur);
        }
        return path.reverse();
      }
      queue[tail++] = v;
    }
  }
  return null;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toGraph(n: number, src: ArrayLike<number>, dst: ArrayLike<number>) {
  const g = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
  for (let i = 0; i < n; i++) g.addNode(i);
  for (let e = 0; e < src.length; e++) {
    if (src[e] !== dst[e]) g.mergeEdge(src[e], dst[e]);
  }
  return g;
}

/**
 * Louvain communities, relabeled so 0 is the largest. Nodes whose community
 * has fewer than `minSize` members get -1.
 */
export function clusterNodes(n: number, src: ArrayLike<number>, dst: ArrayLike<number>, minSize = 2, seed = 42): Int32Array {
  const out = new Int32Array(n).fill(-1);
  if (n === 0 || src.length === 0) return out;
  const g = toGraph(n, src, dst);
  const assignment = louvain(g, { rng: mulberry32(seed), resolution: 1 }) as Record<string, number>;
  const sizes = new Map<number, number>();
  for (const c of Object.values(assignment)) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const ranked = [...sizes.entries()].filter(([, s]) => s >= minSize).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const relabel = new Map(ranked.map(([c], i) => [c, i]));
  for (const [node, c] of Object.entries(assignment)) {
    const r = relabel.get(c);
    if (r != null) out[Number(node)] = r;
  }
  return out;
}

export function pagerank(n: number, src: ArrayLike<number>, dst: ArrayLike<number>): Float64Array {
  const out = new Float64Array(n);
  if (n === 0) return out;
  const g = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  for (let i = 0; i < n; i++) g.addNode(i);
  for (let e = 0; e < src.length; e++) if (src[e] !== dst[e]) g.mergeEdge(src[e], dst[e]);
  const scores = pagerankFn(g, { getEdgeWeight: null }) as Record<string, number>;
  for (const [k, v] of Object.entries(scores)) out[Number(k)] = v;
  return out;
}

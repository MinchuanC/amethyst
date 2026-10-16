import { describe, expect, it } from 'vitest';
import { bfsHops, buildAdjacency, clusterNodes, degreeOf, pagerank, shortestPath } from './analysis';

// Two triangles joined by a bridge (2-3), plus an isolated node 6.
const src = [0, 1, 2, 2, 3, 4, 5];
const dst = [1, 2, 0, 3, 4, 5, 3];
const n = 7;

describe('graph analysis', () => {
  const adj = buildAdjacency(n, src, dst);

  it('builds undirected adjacency', () => {
    expect(degreeOf(adj, 2)).toBe(3);
    expect(degreeOf(adj, 6)).toBe(0);
  });

  it('measures hop distances with a depth limit', () => {
    expect(Array.from(bfsHops(adj, 0, 2))).toEqual([0, 1, 1, 2, -1, -1, -1]);
    expect(Array.from(bfsHops(adj, 0, 9))).toEqual([0, 1, 1, 2, 3, 3, -1]);
  });

  it('finds shortest paths and reports disconnected pairs', () => {
    expect(shortestPath(adj, 0, 4)).toEqual([0, 2, 3, 4]);
    expect(shortestPath(adj, 1, 1)).toEqual([1]);
    expect(shortestPath(adj, 0, 6)).toBeNull();
  });

  it('respects edge filters', () => {
    const noBridge = buildAdjacency(n, src, dst, (e) => e !== 3);
    expect(shortestPath(noBridge, 0, 4)).toBeNull();
  });

  it('separates the two triangles into clusters, largest first', () => {
    const c = clusterNodes(n, src, dst);
    expect(c[0]).toBe(c[1]);
    expect(c[1]).toBe(c[2]);
    expect(c[3]).toBe(c[4]);
    expect(c[0]).not.toBe(c[3]);
    expect(c[6]).toBe(-1);
    expect(Math.min(c[0], c[3])).toBe(0);
  });

  it('is deterministic across runs', () => {
    expect(Array.from(clusterNodes(n, src, dst))).toEqual(Array.from(clusterNodes(n, src, dst)));
  });

  it('ranks the most linked-to node highest', () => {
    const pr = pagerank(4, [0, 1, 2, 3], [3, 3, 3, 0]);
    const best = pr.indexOf(Math.max(...pr));
    expect(best).toBe(3);
  });

  it('ignores self-loops and out-of-range queries', () => {
    const loops = buildAdjacency(2, [0, 0], [0, 1]);
    expect(degreeOf(loops, 0)).toBe(1);
    expect(shortestPath(adj, -1, 0)).toBeNull();
    expect(shortestPath(adj, 0, 99)).toBeNull();
    expect(Array.from(bfsHops(adj, -1, 2))).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  it('returns empty clusters and ranks for an empty graph', () => {
    expect(Array.from(clusterNodes(0, [], []))).toEqual([]);
    expect(Array.from(pagerank(0, [], []))).toEqual([]);
    expect(Array.from(clusterNodes(3, [], []))).toEqual([-1, -1, -1]);
  });
});

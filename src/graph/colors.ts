import type { ColorMode } from '../state/settings';
import type { ViewNode } from './model';

/** Cluster hues, in order of cluster size: the largest constellation gets violet. */
export const CLUSTER_HUES = [
  '#9d7bff',
  '#f062f5',
  '#5eeaf7',
  '#7d8cff',
  '#ff7ab6',
  '#4ff0c8',
  '#c9b6ff',
  '#58a6ff',
  '#ffb86b',
  '#b388ff',
  '#8af5ff',
  '#ff9ee8',
];

export const NEUTRAL = '#8a83a3';
export const UNRESOLVED = '#6c6487';
export const TAG = '#ffd59e';
export const ATTACHMENT = '#7d8fb5';

const AGE_STOPS = ['#3b2a8f', '#6d46f0', '#9d7bff', '#f062f5', '#5eeaf7', '#e8fdff'];

export interface ColorContext {
  mode: ColorMode;
  clusters: Int32Array | null;
  folderRank: Map<string, number>;
  tagRank: Map<string, number>;
  minCreated: number;
  maxCreated: number;
}

const topFolder = (n: ViewNode) => (n.folder ? n.folder.split('/')[0] : '');
const firstTag = (n: ViewNode) => (n.tags[0] ? n.tags[0].split('/')[0].toLowerCase() : '');

/** Ranks folders and tags by how many notes they hold, so the biggest get the first hues. */
export function buildColorContext(nodes: ViewNode[], mode: ColorMode, clusters: Int32Array | null): ColorContext {
  const folders = new Map<string, number>();
  const tags = new Map<string, number>();
  let minCreated = Infinity;
  let maxCreated = -Infinity;
  for (const n of nodes) {
    if (n.kind !== 'note') continue;
    const f = topFolder(n);
    if (f) folders.set(f, (folders.get(f) ?? 0) + 1);
    const t = firstTag(n);
    if (t) tags.set(t, (tags.get(t) ?? 0) + 1);
    if (n.created > 0) {
      minCreated = Math.min(minCreated, n.created);
      maxCreated = Math.max(maxCreated, n.created);
    }
  }
  const rank = (m: Map<string, number>) =>
    new Map([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k], i) => [k, i]));
  return {
    mode,
    clusters,
    folderRank: rank(folders),
    tagRank: rank(tags),
    minCreated: Number.isFinite(minCreated) ? minCreated : 0,
    maxCreated: Number.isFinite(maxCreated) ? maxCreated : 0,
  };
}

function lerpHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

export function ageColor(t: number) {
  const x = Math.min(1, Math.max(0, t)) * (AGE_STOPS.length - 1);
  const i = Math.min(AGE_STOPS.length - 2, Math.floor(x));
  return lerpHex(AGE_STOPS[i], AGE_STOPS[i + 1], x - i);
}

export function ageT(created: number, ctx: ColorContext) {
  const span = ctx.maxCreated - ctx.minCreated;
  return span > 0 ? (created - ctx.minCreated) / span : 1;
}

export function colorFor(node: ViewNode, index: number, ctx: ColorContext): string {
  if (node.kind === 'unresolved') return UNRESOLVED;
  if (node.kind === 'tag') return TAG;
  if (node.kind === 'attachment') return ATTACHMENT;
  switch (ctx.mode) {
    case 'cluster': {
      const c = ctx.clusters?.[index] ?? -1;
      return c >= 0 ? CLUSTER_HUES[c % CLUSTER_HUES.length] : NEUTRAL;
    }
    case 'folder': {
      const r = ctx.folderRank.get(topFolder(node));
      return r == null ? '#c9b6ff' : CLUSTER_HUES[r % CLUSTER_HUES.length];
    }
    case 'tag': {
      const r = ctx.tagRank.get(firstTag(node));
      return r == null ? '#5e5873' : CLUSTER_HUES[r % CLUSTER_HUES.length];
    }
    case 'age':
      return node.created ? ageColor(ageT(node.created, ctx)) : NEUTRAL;
  }
}

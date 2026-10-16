import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode, GraphSnapshot } from '../api/types';
import { buildView, GraphModel, TAG_PREFIX } from './model';

const note = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  title: id.replace(/\.md$/, ''),
  kind: 'note',
  folder: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '',
  tags: [],
  created: 1,
  modified: 1,
  size: 10,
  ...extra,
});

const edge = (source: string, target: string, kind: GraphEdge['kind'] = 'link'): GraphEdge => ({
  id: `${source}\u001f${target}`,
  source,
  target,
  kind,
  count: 1,
});

const snap = (nodes: GraphNode[], edges: GraphEdge[]): GraphSnapshot => ({ nodes, edges });

const allOn = {
  showTags: true,
  showAttachments: true,
  showUnresolved: true,
  showOrphans: true,
  showGhostLinks: true,
};

describe('GraphModel', () => {
  it('loads a snapshot and applies a delta', () => {
    const model = new GraphModel();
    model.load(snap([note('A.md'), note('B.md')], [edge('A.md', 'B.md')]));
    expect(model.nodes.size).toBe(2);
    expect(model.degrees().get('A.md')).toBe(1);

    const summary = model.applyDelta({
      upsertNodes: [note('C.md')],
      removeNodes: ['B.md'],
      upsertEdges: [edge('A.md', 'C.md')],
      removeEdges: [edge('A.md', 'B.md').id],
    });
    expect(summary.addedNodes).toEqual(['C.md']);
    expect(summary.removedNodes).toEqual(['B.md']);
    expect(summary.addedEdges).toEqual([edge('A.md', 'C.md').id]);
    expect(model.nodes.has('B.md')).toBe(false);
    expect(model.edges.size).toBe(1);
  });

  it('counts an upsert of an existing node as a change, not an add', () => {
    const model = new GraphModel();
    model.load(snap([note('A.md')], []));
    const summary = model.applyDelta({
      upsertNodes: [note('A.md', { title: 'Renamed' })],
      removeNodes: [],
      upsertEdges: [],
      removeEdges: [],
    });
    expect(summary.changedNodes).toEqual(['A.md']);
    expect(summary.addedNodes).toEqual([]);
    expect(model.nodes.get('A.md')?.title).toBe('Renamed');
  });
});

describe('buildView', () => {
  const model = new GraphModel();
  model.load(
    snap(
      [
        note('Astro/A.md', { tags: ['space/deep'] }),
        note('Orphan.md'),
        { ...note('pic.png'), kind: 'attachment', title: 'pic.png' },
        { ...note('unresolved:ghost'), kind: 'unresolved', title: 'ghost', folder: '' },
      ],
      [edge('Astro/A.md', 'pic.png', 'embed'), edge('Astro/A.md', 'unresolved:ghost')],
    ),
  );

  it('hides attachments, unresolved notes and orphans when asked', () => {
    const view = buildView(model, {
      showTags: false,
      showAttachments: false,
      showUnresolved: false,
      showOrphans: false,
      showGhostLinks: false,
    });
    expect(view.nodes.map((n) => n.id)).toEqual([]);
  });

  it('keeps an orphan when that filter is on', () => {
    const view = buildView(model, { ...allOn, showTags: false, showGhostLinks: false });
    expect(view.nodes.some((n) => n.id === 'Orphan.md')).toBe(true);
    expect(view.nodes.some((n) => n.id === 'pic.png')).toBe(true);
    expect(view.nodes.some((n) => n.id === 'unresolved:ghost')).toBe(true);
  });

  it('adds tag nodes and parent/child tag edges', () => {
    const view = buildView(model, { ...allOn, showGhostLinks: false });
    const child = TAG_PREFIX + 'space/deep';
    const parent = TAG_PREFIX + 'space';
    expect(view.nodes.some((n) => n.id === child && n.kind === 'tag')).toBe(true);
    expect(view.nodes.some((n) => n.id === parent && n.title === '#space')).toBe(true);
    expect(view.edges.some((e) => e.source === 'Astro/A.md' && e.target === child && e.kind === 'tag')).toBe(true);
    expect(view.edges.some((e) => e.source === child && e.target === parent && e.kind === 'tag')).toBe(true);
  });

  it('adds ghost edges without counting them toward degree', () => {
    const view = buildView(model, { ...allOn, showTags: false }, [{ source: 'Astro/A.md', target: 'Orphan.md', score: 0.4 }]);
    const ghost = view.edges.find((e) => e.kind === 'ghost');
    expect(ghost?.source).toBe('Astro/A.md');
    expect(view.nodes.find((n) => n.id === 'Orphan.md')?.degree).toBe(0);
  });
});

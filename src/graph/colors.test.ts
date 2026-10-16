import { describe, expect, it } from 'vitest';
import { ageColor, ageT, ATTACHMENT, buildColorContext, CLUSTER_HUES, colorFor, NEUTRAL, TAG, UNRESOLVED } from './colors';
import type { ViewNode } from './model';

const node = (partial: Partial<ViewNode> & Pick<ViewNode, 'id'>): ViewNode => ({
  title: partial.id,
  kind: 'note',
  folder: '',
  tags: [],
  created: 0,
  modified: 0,
  degree: 0,
  ...partial,
});

describe('colorFor', () => {
  const notes = [
    node({ id: 'A.md', folder: 'Astro', tags: ['space'], created: 100 }),
    node({ id: 'B.md', folder: 'Astro', tags: ['space'], created: 200 }),
    node({ id: 'C.md', folder: 'Think', tags: ['method'], created: 300 }),
  ];

  it('uses dedicated colours for unresolved, tags and attachments', () => {
    const ctx = buildColorContext(notes, 'cluster', null);
    expect(colorFor(node({ id: 'x', kind: 'unresolved' }), 0, ctx)).toBe(UNRESOLVED);
    expect(colorFor(node({ id: 'tag:space', kind: 'tag' }), 0, ctx)).toBe(TAG);
    expect(colorFor(node({ id: 'p.png', kind: 'attachment' }), 0, ctx)).toBe(ATTACHMENT);
  });

  it('colours notes by Louvain cluster, then folder size, then first tag', () => {
    const clusters = new Int32Array([1, 1, 0]);
    expect(colorFor(notes[0], 0, buildColorContext(notes, 'cluster', clusters))).toBe(CLUSTER_HUES[1]);
    expect(colorFor(notes[2], 2, buildColorContext(notes, 'cluster', clusters))).toBe(CLUSTER_HUES[0]);
    expect(colorFor(notes[0], 0, buildColorContext(notes, 'cluster', null))).toBe(NEUTRAL);

    const folder = buildColorContext(notes, 'folder', null);
    expect(folder.folderRank.get('Astro')).toBe(0);
    expect(colorFor(notes[0], 0, folder)).toBe(CLUSTER_HUES[0]);
    expect(colorFor(notes[2], 2, folder)).toBe(CLUSTER_HUES[1]);

    const tags = buildColorContext(notes, 'tag', null);
    expect(tags.tagRank.get('space')).toBe(0);
    expect(colorFor(notes[0], 0, tags)).toBe(CLUSTER_HUES[0]);
  });

  it('maps created dates onto the age gradient', () => {
    const ctx = buildColorContext(notes, 'age', null);
    expect(ageT(100, ctx)).toBe(0);
    expect(ageT(300, ctx)).toBe(1);
    expect(ageColor(0)).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorFor(notes[0], 0, ctx)).not.toBe(colorFor(notes[2], 2, ctx));
    expect(colorFor(node({ id: 'old.md', created: 0 }), 0, ctx)).toBe(NEUTRAL);
  });
});

import { parser } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { frontmatter } from './frontmatter';

const md = parser.configure([frontmatter]);
const topLevel = (text: string) => {
  const names: string[] = [];
  const cursor = md.parse(text).cursor();
  if (cursor.firstChild()) {
    do names.push(cursor.name);
    while (cursor.nextSibling());
  }
  return names;
};

describe('frontmatter', () => {
  it('parses a leading YAML block as one node', () => {
    expect(topLevel('---\ncreated: 2025-10-24\ntags: [a]\n---\n# Title\n')).toEqual(['Frontmatter', 'ATXHeading1']);
  });

  it('leaves a plain horizontal rule alone', () => {
    expect(topLevel('---\n\nText')).toEqual(['HorizontalRule', 'Paragraph']);
  });
});

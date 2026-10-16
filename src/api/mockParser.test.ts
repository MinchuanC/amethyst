import { describe, expect, it } from 'vitest';
import { parseNote } from './mockParser';

describe('mock parser', () => {
  it('reads frontmatter tags, aliases, created date and headings', () => {
    const p = parseNote('---\ntags: [space, "#physics"]\naliases:\n  - Permanent Notes\ncreated: 2025-11-03\n---\n# Title\nBody #inline\n');
    expect(p.tags).toEqual(['space', 'physics', 'inline']);
    expect(p.aliases).toEqual(['Permanent Notes']);
    expect(p.created).toBe(Date.parse('2025-11-03'));
    expect(p.headings).toEqual([{ level: 1, text: 'Title' }]);
    expect(p.bodyStart).toBeGreaterThan(0);
  });

  it('ignores links and tags inside fences, inline code and math', () => {
    const p = parseNote('Real [[One]]\n\n```\n[[Fenced]] #fenced\n```\n\nInline `[[Inline]]` and $[[Math]]$ then [[Two]]\n');
    expect(p.links.map((l) => l.target)).toEqual(['One', 'Two']);
    expect(p.tags).toEqual([]);
  });

  it('parses markdown image and relative links, skipping urls and anchors', () => {
    const p = parseNote('[layout](../Computing/Force-Directed%20Layout.md) [web](https://x.com) [a](#top) ![img](pics/a.png)');
    expect(p.links.map((l) => [l.target, l.embed, l.markdown])).toEqual([
      ['../Computing/Force-Directed Layout.md', false, true],
      ['pics/a.png', true, true],
    ]);
  });

  it('does not treat frontmatter wikilinks as body links', () => {
    const p = parseNote('---\nsource: "[[Hidden]]"\n---\n[[Visible]]');
    expect(p.links.map((l) => l.target)).toEqual(['Visible']);
  });

  it('skips numeric-only hashes and records nested tags', () => {
    const p = parseNote('#start #123 #method/zettelkasten');
    expect(p.tags).toEqual(['start', 'method/zettelkasten']);
  });
});

import { describe, expect, it } from 'vitest';
import { linkTarget, TAG_RE, WIKILINK_RE } from './wikilinks';

describe('linkTarget', () => {
  it('takes the path before a pipe or heading', () => {
    expect(linkTarget('Nebulae|clouds')).toBe('Nebulae');
    expect(linkTarget('Nebulae#Crab')).toBe('Nebulae');
    expect(linkTarget(' Folder/Note |alias')).toBe('Folder/Note');
    expect(linkTarget('#Section')).toBe('');
  });

  it('strips a trailing backslash Obsidian uses to escape a pipe', () => {
    expect(linkTarget('Note\\|still')).toBe('Note');
  });
});

describe('wikilink and tag scanners', () => {
  it('matches embeds and plain links', () => {
    const text = 'See [[A]] and ![[pic.png]]';
    expect([...text.matchAll(WIKILINK_RE)].map((m) => [m[1], m[2]])).toEqual([
      ['', 'A'],
      ['!', 'pic.png'],
    ]);
  });

  it('finds tags after whitespace and rejects a hash in a word', () => {
    const text = '#start mid#not #nested/tag';
    expect([...text.matchAll(TAG_RE)].map((m) => m[2])).toEqual(['#start', '#nested/tag']);
  });
});

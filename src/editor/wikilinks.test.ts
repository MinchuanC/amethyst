import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { frontmatterEnd, IMAGE_RE, linkTarget, TAG_RE, WIKILINK_RE } from './wikilinks';

const docEnd = (doc: string) => frontmatterEnd(EditorState.create({ doc }));

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

describe('frontmatterEnd', () => {
  it('ends on a closing --- or ... fence', () => {
    const dash = '---\ntags: [a]\n---\n# Title\n';
    const dots = '---\nx: 1\n...\nbody';
    expect(docEnd(dash)).toBe(dash.indexOf('\n# Title'));
    expect(docEnd(dots)).toBe(dots.indexOf('\nbody'));
  });

  it('returns 0 without an opening fence or a close inside 200 lines', () => {
    expect(docEnd('# Title\n')).toBe(0);
    expect(docEnd('---\nno close\n')).toBe(0);
    const pastCap = ['---', ...Array(199).fill('k: v'), '---'].join('\n');
    expect(docEnd(pastCap)).toBe(0);
    const onCap = ['---', ...Array(198).fill('k: v'), '---', 'body'].join('\n');
    expect(docEnd(onCap)).toBe(onCap.indexOf('\nbody'));
  });
});

describe('IMAGE_RE', () => {
  it('matches image extensions at the end of a path', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'PNG']) {
      expect(IMAGE_RE.test(`pics/a.${ext}`)).toBe(true);
    }
    expect(IMAGE_RE.test('Note.md')).toBe(false);
    expect(IMAGE_RE.test('png-notes.md')).toBe(false);
  });
});

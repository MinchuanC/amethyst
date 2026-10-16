// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectTargets, renderMarkdown, splitFrontmatter } from './markdown';

const ctx = {
  resolve: (t: string) => ({ Nebulae: 'Astronomy/Nebulae.md', 'crab.svg': 'attachments/crab.svg' })[t] ?? null,
  assetUrl: (p: string) => `asset://localhost/vault/${p}`,
};
const render = (md: string) => renderMarkdown(md, ctx);

describe('reading view rendering', () => {
  it('renders wikilinks, missing links and image embeds', () => {
    const html = render('See [[Nebulae|clouds]] and [[Missing]].\n\n![[crab.svg]]');
    expect(html).toContain('class="wikilink" data-target="Nebulae">clouds</a>');
    expect(html).toContain('class="wikilink unresolved" data-target="Missing"');
    expect(html).toContain('<img class="rv-embed" src="asset://localhost/vault/attachments/crab.svg"');
  });

  it('renders Obsidian callouts with their type and title', () => {
    const html = render('> [!warning] Mind the gap\n> Trains are fast.');
    expect(html).toContain('<div class="callout" data-callout="warning">');
    expect(html).toContain('<p class="callout-title">Mind the gap</p>');
    expect(html).toContain('Trains are fast.');
    expect(html).not.toContain('[!warning]');
    expect(render('> [!tip]\n> body')).toContain('<p class="callout-title">Tip</p>');
    expect(render('> plain quote')).toContain('<blockquote>');
  });

  it('renders highlights and drops comments', () => {
    const html = render('A ==bright== idea %%secret%% here.');
    expect(html).toContain('<mark>bright</mark>');
    expect(html).not.toContain('secret');
  });

  it('renders inline and block math, but leaves prices alone', () => {
    expect(render('Energy $E=mc^2$ rules.')).toContain('class="katex"');
    expect(render('$$\n\\int_0^1 x\\,dx\n$$')).toContain('class="math-block"');
    expect(render('It cost $5 and $6 later.')).not.toContain('katex');
  });

  it('renders footnotes, tags and tasks', () => {
    const html = render('Claim[^1] #space\n\n- [x] done\n- [ ] todo\n\n[^1]: Source.');
    expect(html).toContain('class="footnotes"');
    expect(html).toContain('<span class="tag" data-tag="space">#space</span>');
    expect(html).toContain('class="task done"');
    expect(html).toContain('class="task"');
  });

  it('strips scripts from raw HTML', () => {
    expect(render('<img src=x onerror="alert(1)"><script>alert(2)</script>')).not.toMatch(/onerror|<script/);
  });
});

describe('frontmatter and targets', () => {
  it('splits frontmatter into properties', () => {
    const { fm, body } = splitFrontmatter('---\ntags: [a, "#b"]\naliases:\n  - One\ncreated: 2025-01-02\n---\nBody');
    expect(fm?.tags).toEqual(['a', 'b']);
    expect(fm?.aliases).toEqual(['One']);
    expect(fm?.fields).toEqual([['created', '2025-01-02']]);
    expect(body).toBe('Body');
  });

  it('collects link and image targets', () => {
    expect(collectTargets('[[A#h]] ![[b.png]] ![x](c%20d.png) ![y](https://e.com/f.png)').sort()).toEqual(['A', 'b.png', 'c d.png']);
  });

  it('keeps a missing closing fence as body text', () => {
    const { fm, body } = splitFrontmatter('---\ntags: a\n# Title');
    expect(fm).toBeNull();
    expect(body.startsWith('---')).toBe(true);
  });

  it('accepts CR LF frontmatter used by some editors', () => {
    const { fm, body } = splitFrontmatter('---\r\ntags: [one]\r\n---\r\nHi');
    expect(fm?.tags).toEqual(['one']);
    expect(body).toBe('Hi');
  });
});

describe('tables, headings and transclusions', () => {
  it('renders a markdown table', () => {
    const html = render('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('1');
  });

  it('marks external links and keeps wiki heading display', () => {
    const html = render('See [[Nebulae#Crab]] and [NASA](https://nasa.gov).');
    expect(html).toContain('Nebulae › Crab');
    expect(html).toContain('data-external="true"');
  });

  it('renders a transclusion fallback when the embed is missing', () => {
    const html = render('![[Ghost Note]]');
    expect(html).toContain('class="wikilink unresolved transclusion"');
    expect(html).toContain('↳ Ghost Note');
  });

  it('does not treat a hash in a URL as a tag', () => {
    expect(render('See http://x.com/#frag and #real')).toContain('data-tag="real"');
    expect(render('See http://x.com/#frag and #real')).not.toContain('data-tag="frag"');
  });

  it('strips %%comments%% before parse, including inside fences', () => {
    expect(render('shown %%hidden%% text')).not.toContain('hidden');
    expect(render('```\n%%keep%%\n```')).not.toContain('keep');
  });
});

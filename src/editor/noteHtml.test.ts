import { describe, expect, it } from 'vitest';
import { sectionOf, withoutDuplicateTitle } from './noteHtml';

describe('sectionOf', () => {
  const body = ['# Title', 'intro', '## Crab', 'the crab', '### Inner', 'nested', '## Orion', 'dust'].join('\n');

  it('returns the heading through the next heading of the same or higher level', () => {
    expect(sectionOf(body, 'Crab')).toBe(['## Crab', 'the crab', '### Inner', 'nested'].join('\n'));
  });

  it('is case-insensitive and trims the heading name', () => {
    expect(sectionOf(body, '  orion  ')).toBe('## Orion\ndust');
  });

  it('returns the whole body when the heading is missing', () => {
    expect(sectionOf(body, 'Missing')).toBe(body);
  });
});

describe('withoutDuplicateTitle', () => {
  it('removes a leading heading that repeats the note title', () => {
    expect(withoutDuplicateTitle('<h1>Writing in Amethyst</h1>\n<p>Body</p>', 'Writing in Amethyst')).toBe('\n<p>Body</p>');
  });

  it('keeps a heading that is a different claim', () => {
    const html = '<h1>A different claim</h1><p>Body</p>';
    expect(withoutDuplicateTitle(html, 'Writing in Amethyst')).toBe(html);
  });
});

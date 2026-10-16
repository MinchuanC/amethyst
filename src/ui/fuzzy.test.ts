import { describe, expect, it } from 'vitest';
import { fuzzyMatch, rank } from './fuzzy';

describe('fuzzyMatch', () => {
  it('rejects non-subsequences', () => {
    expect(fuzzyMatch('xyz', 'Graph Theory')).toBeNull();
  });

  it('prefers exact and word-start matches', () => {
    const exact = fuzzyMatch('nebulae', 'Nebulae')!.score;
    const prefix = fuzzyMatch('neb', 'Nebulae')!.score;
    const inner = fuzzyMatch('ula', 'Nebulae')!.score;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(inner);
  });

  it('matches scattered letters', () => {
    const m = fuzzyMatch('fdl', 'Force-Directed Layout');
    expect(m).not.toBeNull();
    expect(m!.indices).toEqual([0, 6, 15]);
  });
});

describe('rank', () => {
  it('orders by score and keeps all items for empty queries', () => {
    const items = ['Black Holes', 'Galaxies', 'Event Horizon'];
    expect(rank(items, '', (s) => s).map((r) => r.item)).toEqual(items);
    expect(rank(items, 'hol', (s) => s)[0].item).toBe('Black Holes');
  });

  it('caps results and drops non-matches', () => {
    const items = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    expect(rank(items, 'a', (s) => s, 2)).toHaveLength(2);
    expect(rank(items, 'zzz', (s) => s)).toEqual([]);
  });

  it('matches across folder separators', () => {
    expect(fuzzyMatch('an', 'Astronomy/Nebulae')).not.toBeNull();
    expect(fuzzyMatch('  NEB  ', 'Nebulae')!.score).toBeGreaterThan(0);
  });
});

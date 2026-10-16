/**
 * Subsequence fuzzy match. Returns null when `query` isn't a subsequence of
 * `text`; otherwise a score (higher is better) and matched indices.
 */
export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) {
    const atWord = direct === 0 || /[\s/_\-.]/.test(t[direct - 1]);
    const indices = Array.from({ length: q.length }, (_, i) => direct + i);
    return { score: 1000 - direct * 2 + (atWord ? 300 : 0) + (q.length === t.length ? 500 : 0) - t.length * 0.5, indices };
  }
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    indices.push(found);
    const atWord = found === 0 || /[\s/_\-.]/.test(t[found - 1]);
    score += found === prev + 1 ? 15 : 1;
    if (atWord) score += 10;
    score -= Math.min(found - ti, 10) * 0.5;
    prev = found;
    ti = found + 1;
  }
  return { score: score - t.length * 0.2, indices };
}

export function rank<T>(items: T[], query: string, key: (item: T) => string, limit = 60) {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, indices: [] as number[] }));
  const scored: { item: T; score: number; indices: number[] }[] = [];
  for (const item of items) {
    const m = fuzzyMatch(query, key(item));
    if (m) scored.push({ item, score: m.score, indices: m.indices });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

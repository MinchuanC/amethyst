import { describe, expect, it } from 'vitest';
import { advanceGesture, beginGesture, releaseGesture } from './pointer';

describe('graph pointer gesture', () => {
  it('selects a short still press', () => {
    let g = beginGesture();
    g = advanceGesture(g, 0, 80);
    expect(g.phase).toBe('pending');
    expect(g.pinned).toBe(false);
    expect(releaseGesture(g)).toBe('select');
  });

  it('pins once the pointer moves past the drag threshold before the hold window', () => {
    let g = beginGesture();
    g = advanceGesture(g, 9, 40);
    expect(g).toEqual({ phase: 'drag', pinned: true });
    g = advanceGesture(g, 40, 800);
    expect(g.phase).toBe('drag');
    expect(releaseGesture(g)).toBe('none');
  });

  it('locks a still long-press as a hold, and later jitter cannot pin or select', () => {
    let g = beginGesture();
    g = advanceGesture(g, 3, 200);
    expect(g.phase).toBe('pending');
    g = advanceGesture(g, 3, 500);
    expect(g).toEqual({ phase: 'hold', pinned: false });
    g = advanceGesture(g, 30, 900);
    expect(g).toEqual({ phase: 'hold', pinned: false });
    expect(releaseGesture(g)).toBe('none');
  });

  it('ignores sub-threshold wobble during a click', () => {
    const g = advanceGesture(beginGesture(), 7, 120);
    expect(g.phase).toBe('pending');
    expect(releaseGesture(g)).toBe('select');
  });
});

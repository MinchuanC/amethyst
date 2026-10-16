import { describe, expect, it } from 'vitest';
import { computeClusterAnchors } from './labels';

describe('computeClusterAnchors', () => {
  it('places the anchor at the mean of member positions', () => {
    const positions = new Float32Array([
      0, 0, 0, // 0 cluster 0
      2, 0, 0, // 1 cluster 0
      0, 2, 0, // 2 cluster 0
      2, 2, 0, // 3 cluster 0
      10, 0, 0, // 4 ignored
    ]);
    const assignment = new Int32Array([0, 0, 0, 0, -1]);
    const [anchor] = computeClusterAnchors(positions, assignment, [{ index: 0, size: 4 }]);
    expect(anchor).toMatchObject({ index: 0, x: 1, y: 1, z: 0 });
    expect(anchor.radius).toBeCloseTo(Math.hypot(1, 1));
  });

  it('skips tiny or unassigned groups so labels stay on real constellations', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 8, 0, 0]);
    const assignment = new Int32Array([0, 0, 1]);
    expect(computeClusterAnchors(positions, assignment, [{ index: 0, size: 2 }, { index: 1, size: 1 }])).toEqual([]);
  });
});

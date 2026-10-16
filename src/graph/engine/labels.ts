export type LabelKind = 'hover' | 'focus' | 'path' | 'neighbor' | 'highlight' | 'hub';

export interface ClusterAnchor {
  index: number;
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** World-space centre and radius of each constellation, so labels can track the camera every frame. */
export function computeClusterAnchors(
  positions: ArrayLike<number>,
  assignment: ArrayLike<number>,
  clusters: { index: number; size: number }[],
): ClusterAnchor[] {
  const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
  for (let i = 0; i < assignment.length; i++) {
    const id = assignment[i];
    if (id < 0 || id > 9) continue;
    const s = sums.get(id) ?? { x: 0, y: 0, z: 0, n: 0 };
    s.x += positions[i * 3] ?? 0;
    s.y += positions[i * 3 + 1] ?? 0;
    s.z += positions[i * 3 + 2] ?? 0;
    s.n++;
    sums.set(id, s);
  }
  const centres = new Map<number, { x: number; y: number; z: number; n: number }>();
  for (const [id, s] of sums) {
    if (s.n < 4) continue;
    centres.set(id, { x: s.x / s.n, y: s.y / s.n, z: s.z / s.n, n: s.n });
  }
  const radii = new Map<number, number>();
  for (let i = 0; i < assignment.length; i++) {
    const c = centres.get(assignment[i]);
    if (!c) continue;
    const r = Math.hypot((positions[i * 3] ?? 0) - c.x, (positions[i * 3 + 1] ?? 0) - c.y, (positions[i * 3 + 2] ?? 0) - c.z);
    radii.set(assignment[i], Math.max(radii.get(assignment[i]) ?? 0, r));
  }
  return clusters
    .filter((c) => c.size >= 3 && centres.has(c.index))
    .map((c) => {
      const centre = centres.get(c.index)!;
      return { index: c.index, x: centre.x, y: centre.y, z: centre.z, radius: radii.get(c.index) ?? 0 };
    });
}

export interface PlacedLabel {
  key: number;
  x: number;
  y: number;
  text: string;
  kind: LabelKind;
  alpha: number;
}

export interface PlacedCluster {
  key: number;
  x: number;
  y: number;
  text: string;
  count: number;
  color: string;
  alpha: number;
}

/**
 * Note titles drawn as DOM text over the canvas: crisp at any zoom, any
 * script, and set in the interface font rather than a texture atlas.
 */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private clusterPool: HTMLDivElement[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'g-labels';
    this.root.setAttribute('aria-hidden', 'true');
    container.appendChild(this.root);
  }

  private take(pool: HTMLDivElement[], i: number, cls: string) {
    let el = pool[i];
    if (!el) {
      el = document.createElement('div');
      el.className = cls;
      this.root.appendChild(el);
      pool[i] = el;
    }
    return el;
  }

  render(labels: PlacedLabel[]) {
    labels.forEach((l, i) => {
      const el = this.take(this.pool, i, 'g-label');
      if (el.dataset.text !== l.text) {
        el.textContent = l.text;
        el.dataset.text = l.text;
      }
      if (el.dataset.kind !== l.kind) el.dataset.kind = l.kind;
      el.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0)`;
      el.style.opacity = l.alpha.toFixed(2);
      el.style.display = '';
    });
    for (let i = labels.length; i < this.pool.length; i++) this.pool[i].style.display = 'none';
  }

  renderClusters(items: PlacedCluster[]) {
    items.forEach((c, i) => {
      const el = this.take(this.clusterPool, i, 'g-cluster');
      const text = `${c.text}|${c.count}`;
      if (el.dataset.text !== text) {
        el.innerHTML = '';
        const name = document.createElement('span');
        name.textContent = c.text;
        const count = document.createElement('small');
        count.textContent = `${c.count} notes`;
        el.append(name, count);
        el.dataset.text = text;
      }
      el.style.setProperty('--c', c.color);
      el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
      el.style.opacity = c.alpha.toFixed(2);
      el.style.display = '';
    });
    for (let i = items.length; i < this.clusterPool.length; i++) this.clusterPool[i].style.display = 'none';
  }

  clear() {
    this.render([]);
    this.renderClusters([]);
  }

  dispose() {
    this.root.remove();
  }
}

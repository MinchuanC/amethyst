declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }
  export interface SimLink<N extends SimNode = SimNode> {
    source: number | N;
    target: number | N;
    index?: number;
  }
  export interface Force<N extends SimNode = SimNode> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...args: unknown[]) => void;
  }
  export interface Simulation<N extends SimNode = SimNode> {
    tick(iterations?: number): this;
    stop(): this;
    restart(): this;
    alpha(): number;
    alpha(a: number): this;
    alphaMin(): number;
    alphaMin(a: number): this;
    alphaDecay(): number;
    alphaDecay(a: number): this;
    alphaTarget(): number;
    alphaTarget(a: number): this;
    velocityDecay(): number;
    velocityDecay(a: number): this;
    numDimensions(): number;
    numDimensions(n: number): this;
    nodes(): N[];
    nodes(n: N[]): this;
    force(name: string): Force<N> | undefined;
    force(name: string, force: Force<N> | null): this;
  }
  export interface LinkForce<N extends SimNode, L extends SimLink<N>> extends Force<N> {
    links(): L[];
    links(l: L[]): this;
    distance(d: number | ((l: L) => number)): this;
    strength(s: number | ((l: L) => number)): this;
    iterations(n: number): this;
  }
  export interface ManyBodyForce<N extends SimNode> extends Force<N> {
    strength(s: number | ((n: N) => number)): this;
    theta(t: number): this;
    distanceMin(d: number): this;
    distanceMax(d: number): this;
  }
  export interface PositionForce<N extends SimNode> extends Force<N> {
    strength(s: number | ((n: N) => number)): this;
  }
  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: number): Simulation<N>;
  export function forceLink<N extends SimNode, L extends SimLink<N>>(links?: L[]): LinkForce<N, L>;
  export function forceManyBody<N extends SimNode>(): ManyBodyForce<N>;
  export function forceCenter<N extends SimNode>(x?: number, y?: number, z?: number): Force<N>;
  export function forceX<N extends SimNode>(x?: number): PositionForce<N>;
  export function forceY<N extends SimNode>(y?: number): PositionForce<N>;
  export function forceZ<N extends SimNode>(z?: number): PositionForce<N>;
}

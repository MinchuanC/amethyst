import CameraControls from 'camera-controls';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import type { ColorMode } from '../../state/settings';
import { buildAdjacency, bfsHops, shortestPath, type Adjacency } from '../analysis';
import { buildColorContext, colorFor, CLUSTER_HUES, type ColorContext } from '../colors';
import type { Dims, FromWorker, ToWorker } from '../layoutProtocol';
import type { ViewEdgeKind, ViewGraph, ViewNode } from '../model';
import { allocEdges, allocNodes, EdgeLayer, NodeLayer, PathBeam, SkyLayer, type EdgeBuffers, type NodeBuffers } from './layers';
import { computeClusterAnchors, LabelLayer, type ClusterAnchor, type LabelKind, type PlacedCluster, type PlacedLabel } from './labels';
import { advanceGesture, beginGesture, CLICK_MS, releaseGesture, type Gesture } from './pointer';

CameraControls.install({ THREE });

export interface ClusterSummary {
  index: number;
  size: number;
  hubId: string;
  hubTitle: string;
  color: string;
}

interface EngineEvents {
  hover: [id: string | null, x: number, y: number];
  select: [id: string | null, mods: { shift: boolean; meta: boolean }];
  open: [id: string];
  clusters: [assignment: Map<string, number>, list: ClusterSummary[]];
  colors: [colors: Map<string, string>];
  settled: [positions: Map<string, number[]>, dims: Dims];
  fps: [fps: number];
  timelapse: [t: number, playing: boolean];
}

export interface SetGraphOptions {
  cached?: Map<string, number[]>;
  pulse?: string[];
  animateNew?: boolean;
}

const KIND_CODE: Record<ViewNode['kind'], number> = { note: 0, unresolved: 1, attachment: 2, tag: 3 };
const EDGE_CODE: Record<ViewEdgeKind, number> = { link: 0, embed: 1, tag: 2, ghost: 3 };
const TIMELAPSE_SECONDS = 22;

class Tween {
  constructor(
    public value: number,
    public target = value,
    public rate = 4,
  ) {}
  step(dt: number, instant: boolean) {
    if (instant) this.value = this.target;
    else this.value += (this.target - this.value) * (1 - Math.exp(-this.rate * dt));
    if (Math.abs(this.target - this.value) < 0.0005) this.value = this.target;
    return this.value;
  }
}

export class GraphEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: CameraControls;
  private composer: EffectComposer;
  private bloom: BloomEffect;
  private worker: Worker;
  private labels: LabelLayer;
  private nodeLayer: NodeLayer;
  private edgeLayer: EdgeLayer;
  private sky: SkyLayer;
  private beam: PathBeam;
  private resizeObserver: ResizeObserver;
  private listeners: { [K in keyof EngineEvents]?: Set<(...args: EngineEvents[K]) => void> } = {};

  private u = {
    uTime: { value: 0 },
    uFocusOn: { value: 0 },
    uFocusTime: { value: 0 },
    uFocusDepth: { value: 2 },
    uTimelapseOn: { value: 0 },
    uTimeCursor: { value: 1 },
    uHoverOn: { value: 0 },
    uDim: { value: 1 },
    uFogNear: { value: 600 },
    uFogFar: { value: 2400 },
    uViewportH: { value: 800 },
    uSizeScale: { value: 1 },
    uFlow: { value: 1 },
    uPixelRatio: { value: 1 },
  };

  private nodes: ViewNode[] = [];
  private ids: string[] = [];
  private index = new Map<string, number>();
  private positions: Float32Array = new Float32Array(0);
  private nb: NodeBuffers = allocNodes(0);
  private eb: EdgeBuffers = allocEdges(0);
  private src = new Uint32Array(0);
  private dst = new Uint32Array(0);
  private edgeIds: string[] = [];
  private edgeKinds = new Uint8Array(0);
  private edgeLookup = new Map<number, number>();
  private adjAll: Adjacency = { offsets: new Int32Array(1), neighbors: new Int32Array(0) };
  private adjLinks: Adjacency = this.adjAll;
  private incident: Adjacency = this.adjAll;
  private degree = new Int32Array(0);
  private hubs: number[] = [];
  private clusters: Int32Array | null = null;
  private clusterList: ClusterSummary[] = [];
  private clusterAnchors: ClusterAnchor[] = [];
  private interacting = false;
  private colorCtx: ColorContext | null = null;
  private colorMode: ColorMode = 'cluster';
  private dims: Dims = 3;
  private version = 0;
  private graphRadius = 300;
  private groupClusters = true;

  private hover = -1;
  private focusIndex = -1;
  private persistent = new Set<number>();
  private pathNodes: number[] = [];
  private ambient = false;
  private reduced: boolean;
  private linkFlow = true;
  private focusTween = new Tween(0, 0, 3.5);
  private hoverTween = new Tween(0, 0, 6);
  private dimTween = new Tween(1, 1, 2.5);
  private beamTween = new Tween(0, 0, 1.4);
  private timelapse = { active: false, playing: false, t: 1, speed: 1, lastEmit: 0 };

  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private frame = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private positionsDirty = false;
  private autoFit = true;
  private userMoved = false;
  private followFocus = false;
  private ticksSinceFit = 0;
  private vp = new THREE.Matrix4();
  private mouse = { x: 0, y: 0, inside: false, pending: false };
  private down: { x: number; y: number; t: number; node: number; pointerId: number; gesture: Gesture; cameraLocked: boolean } | null = null;
  private holdTimer = 0;
  private dragPlane = new THREE.Plane();
  private raycaster = new THREE.Raycaster();
  private width = 1;
  private height = 1;
  private viewShift = 0;

  constructor(container: HTMLElement, opts: { reducedMotion: boolean }) {
    this.container = container;
    this.reduced = opts.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor('#07060b');
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.appendChild(this.renderer.domElement);
    this.u.uPixelRatio.value = this.renderer.getPixelRatio();

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
    this.camera.position.set(0, 120, 900);
    this.controls = new CameraControls(this.camera, this.renderer.domElement);
    this.controls.smoothTime = this.reduced ? 0 : 0.5;
    this.controls.draggingSmoothTime = 0.12;
    this.controls.dollySpeed = 0.55;
    this.controls.dollyToCursor = true;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 9000;
    this.controls.azimuthRotateSpeed = 0.55;
    this.controls.polarRotateSpeed = 0.55;
    this.controls.addEventListener('controlstart', () => {
      this.userMoved = true;
      this.interacting = true;
      this.autoFit = false;
      this.followFocus = false;
    });
    this.controls.addEventListener('controlend', () => {
      this.interacting = false;
    });

    this.sky = new SkyLayer(this.u.uTime, this.u.uPixelRatio, this.u.uViewportH);
    this.nodeLayer = new NodeLayer(this.u);
    this.edgeLayer = new EdgeLayer(this.u);
    this.beam = new PathBeam(this.u.uTime);
    this.scene.add(this.sky.far, this.sky.dust, this.edgeLayer.lines, this.nodeLayer.mesh, this.beam.mesh);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ intensity: 1.35, luminanceThreshold: 0.1, luminanceSmoothing: 0.4, mipmapBlur: true, radius: 0.72, levels: 7 });
    this.composer.addPass(
      new EffectPass(this.camera, this.bloom, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), new VignetteEffect({ offset: 0.3, darkness: 0.58 })),
    );

    this.labels = new LabelLayer(container);

    this.worker = new Worker(new URL('../layout.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onWorker(e.data);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindPointer();
    this.raf = requestAnimationFrame(this.loop);
  }

  on<K extends keyof EngineEvents>(event: K, cb: (...args: EngineEvents[K]) => void) {
    type Handler = (...args: EngineEvents[K]) => void;
    const set = (this.listeners[event] ?? new Set<Handler>()) as Set<Handler>;
    (this.listeners as Record<K, Set<Handler>>)[event] = set;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  private emit<K extends keyof EngineEvents>(event: K, ...args: EngineEvents[K]) {
    (this.listeners[event] as Set<(...a: EngineEvents[K]) => void> | undefined)?.forEach((cb) => cb(...args));
  }

  private post(msg: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }

  // ---------------------------------------------------------------- graph

  setGraph(view: ViewGraph, opts: SetGraphOptions = {}) {
    const prevIndex = this.index;
    const prevPositions = this.positions;
    const prevEdgeIds = new Set(this.edgeIds);
    const hadGraph = this.ids.length > 0;
    const focusId = this.focusIndex >= 0 ? this.ids[this.focusIndex] : null;
    const persistentIds = [...this.persistent].map((i) => this.ids[i]);
    const pathIds = this.pathNodes.map((i) => this.ids[i]);

    const n = view.nodes.length;
    this.nodes = view.nodes;
    this.ids = view.nodes.map((v) => v.id);
    this.index = new Map(this.ids.map((id, i) => [id, i]));

    const edges = view.edges.filter((e) => this.index.has(e.source) && this.index.has(e.target) && e.source !== e.target);
    const m = edges.length;
    this.src = new Uint32Array(m);
    this.dst = new Uint32Array(m);
    this.edgeKinds = new Uint8Array(m);
    this.edgeIds = edges.map((e) => e.id);
    this.edgeLookup = new Map();
    edges.forEach((e, k) => {
      const a = this.index.get(e.source)!;
      const b = this.index.get(e.target)!;
      this.src[k] = a;
      this.dst[k] = b;
      this.edgeKinds[k] = EDGE_CODE[e.kind];
      this.edgeLookup.set(a * n + b, k);
      this.edgeLookup.set(b * n + a, k);
    });
    this.adjAll = buildAdjacency(n, this.src, this.dst, (e) => this.edgeKinds[e] !== 3);
    this.adjLinks = buildAdjacency(n, this.src, this.dst, (e) => this.edgeKinds[e] < 2);
    this.incident = this.buildIncident(n);
    this.degree = new Int32Array(n);
    for (let i = 0; i < n; i++) this.degree[i] = this.adjAll.offsets[i + 1] - this.adjAll.offsets[i];
    this.hubs = [...Array(n).keys()].filter((i) => this.nodes[i].kind !== 'unresolved').sort((a, b) => this.degree[b] - this.degree[a]).slice(0, 40);

    const known = new Uint8Array(n);
    this.nb = allocNodes(n);
    this.positions = this.nb.offset;
    let knownCount = 0;
    for (let i = 0; i < n; i++) {
      const id = this.ids[i];
      const prev = prevIndex.get(id);
      const cached = opts.cached?.get(id);
      if (prev != null && prev * 3 + 2 < prevPositions.length) {
        this.positions.set(prevPositions.subarray(prev * 3, prev * 3 + 3), i * 3);
        known[i] = 1;
      } else if (cached) {
        this.positions.set([cached[0], cached[1], this.dims === 3 ? cached[2] ?? 0 : 0], i * 3);
        known[i] = 1;
      }
      if (known[i]) knownCount++;
    }
    if (knownCount > 0) {
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          if (known[i]) continue;
          let sx = 0;
          let sy = 0;
          let sz = 0;
          let c = 0;
          for (let k = this.adjAll.offsets[i]; k < this.adjAll.offsets[i + 1]; k++) {
            const j = this.adjAll.neighbors[k];
            if (!known[j]) continue;
            sx += this.positions[j * 3];
            sy += this.positions[j * 3 + 1];
            sz += this.positions[j * 3 + 2];
            c++;
          }
          if (c === 0 && pass === 0) continue;
          const spread = c ? 18 : this.graphRadius * 1.2;
          this.positions[i * 3] = (c ? sx / c : 0) + (Math.random() - 0.5) * spread;
          this.positions[i * 3 + 1] = (c ? sy / c : 0) + (Math.random() - 0.5) * spread;
          this.positions[i * 3 + 2] = this.dims === 3 ? (c ? sz / c : 0) + (Math.random() - 0.5) * spread : 0;
          known[i] = 1;
        }
      }
    }

    const now = this.u.uTime.value;
    const pulse = new Set(opts.pulse ?? []);
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i];
      this.nb.kind[i] = KIND_CODE[node.kind];
      const base = node.kind === 'unresolved' ? 6 : node.kind === 'tag' ? 7.5 : node.kind === 'attachment' ? 6 : 7.5;
      this.nb.size[i] = base + Math.min(18, Math.sqrt(this.degree[i]) * 3.4);
      const isNew = hadGraph && !prevIndex.has(node.id);
      if ((opts.animateNew && isNew) || pulse.has(node.id)) this.nb.pulse[i] = now;
    }

    this.eb = allocEdges(m);
    for (let k = 0; k < m; k++) {
      const seed = ((k * 2654435761) % 1000) / 1000;
      this.eb.t[k * 2] = 0;
      this.eb.t[k * 2 + 1] = 1;
      this.eb.seed[k * 2] = this.eb.seed[k * 2 + 1] = seed;
      this.eb.kind[k * 2] = this.eb.kind[k * 2 + 1] = this.edgeKinds[k];
      if (opts.animateNew && hadGraph && !prevEdgeIds.has(this.edgeIds[k])) this.eb.born[k * 2] = this.eb.born[k * 2 + 1] = now;
    }
    this.applyBirths();

    this.nodeLayer.setBuffers(this.nb, n);
    this.edgeLayer.setBuffers(this.eb);
    this.recolor();
    this.writeEdgePositions();

    this.hover = -1;
    this.focusIndex = -1;
    this.persistent = new Set(persistentIds.map((id) => this.index.get(id)).filter((i): i is number => i != null));
    this.pathNodes = pathIds.every((id) => this.index.has(id)) ? pathIds.map((id) => this.index.get(id)!) : [];
    if (focusId && this.index.has(focusId)) this.focus(focusId, this.u.uFocusDepth.value, false);
    else this.focusTween.target = 0;
    this.refreshHighlight();
    if (!hadGraph) this.autoFit = !this.userMoved;

    this.version++;
    const allKnown = knownCount === n;
    const alpha = n === 0 ? 0 : allKnown ? (hadGraph ? 0.12 : 0.04) : knownCount > 0 ? 0.35 : 1;
    const springs = new Uint8Array(m);
    for (let k = 0; k < m; k++) springs[k] = this.edgeKinds[k] === 3 ? 0 : 1;
    this.post({
      type: 'init',
      version: this.version,
      n,
      positions: this.positions.slice(),
      known,
      src: this.src.slice(),
      dst: this.dst.slice(),
      springs,
      dims: this.dims,
      alpha,
      groupClusters: this.groupClusters,
    });
    this.updateRadius();
    this.clusters = null;
    this.clusterList = [];
    this.clusterAnchors = [];
  }

  private buildIncident(n: number): Adjacency {
    const counts = new Int32Array(n + 1);
    for (let e = 0; e < this.src.length; e++) {
      counts[this.src[e] + 1]++;
      counts[this.dst[e] + 1]++;
    }
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    const fill = counts.slice(0, n);
    const edges = new Int32Array(counts[n]);
    for (let e = 0; e < this.src.length; e++) {
      edges[fill[this.src[e]]++] = e;
      edges[fill[this.dst[e]]++] = e;
    }
    return { offsets: counts, neighbors: edges };
  }

  private applyBirths() {
    let min = Infinity;
    let max = -Infinity;
    for (const node of this.nodes) {
      if (node.created > 0) {
        min = Math.min(min, node.created);
        max = Math.max(max, node.created);
      }
    }
    const span = max - min;
    for (let i = 0; i < this.nodes.length; i++) {
      const c = this.nodes[i].created;
      this.nb.birth[i] = span > 0 && c > 0 ? ((c - min) / span) * 0.97 : 0;
    }
    for (let k = 0; k < this.src.length; k++) {
      const b = Math.max(this.nb.birth[this.src[k]], this.nb.birth[this.dst[k]]);
      this.eb.birth[k * 2] = this.eb.birth[k * 2 + 1] = b;
    }
  }

  /** The vault's date range, for the time-lapse readout. */
  timeRange(): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const node of this.nodes) {
      if (node.created > 0) {
        min = Math.min(min, node.created);
        max = Math.max(max, node.created);
      }
    }
    return Number.isFinite(min) ? [min, max] : [0, 0];
  }

  private recolor() {
    this.colorCtx = buildColorContext(this.nodes, this.colorMode, this.clusters);
    const css = new Map<string, string>();
    const c = new THREE.Color();
    for (let i = 0; i < this.nodes.length; i++) {
      const hex = colorFor(this.nodes[i], i, this.colorCtx);
      css.set(this.ids[i], hex);
      c.set(hex);
      this.nb.color.set([c.r, c.g, c.b], i * 3);
    }
    const ghost = new THREE.Color('#c9c4ff');
    for (let k = 0; k < this.src.length; k++) {
      const a = this.src[k] * 3;
      const b = this.dst[k] * 3;
      if (this.edgeKinds[k] === 3) {
        this.eb.color.set([ghost.r, ghost.g, ghost.b, ghost.r, ghost.g, ghost.b], k * 6);
      } else {
        this.eb.color.set([this.nb.color[a], this.nb.color[a + 1], this.nb.color[a + 2], this.nb.color[b], this.nb.color[b + 1], this.nb.color[b + 2]], k * 6);
      }
    }
    this.nodeLayer.touch('color');
    this.edgeLayer.touch('color');
    this.emit('colors', css);
  }

  private writeEdgePositions() {
    const p = this.positions;
    const out = this.eb.position;
    for (let k = 0; k < this.src.length; k++) {
      const a = this.src[k] * 3;
      const b = this.dst[k] * 3;
      out[k * 6] = p[a];
      out[k * 6 + 1] = p[a + 1];
      out[k * 6 + 2] = p[a + 2];
      out[k * 6 + 3] = p[b];
      out[k * 6 + 4] = p[b + 1];
      out[k * 6 + 5] = p[b + 2];
    }
    this.nodeLayer.touch('offset');
    this.edgeLayer.touch('position');
  }

  private updateRadius() {
    const n = this.ids.length;
    if (!n) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += this.positions[i * 3];
      cy += this.positions[i * 3 + 1];
      cz += this.positions[i * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    const d: number[] = [];
    for (let i = 0; i < n; i++) {
      d.push(Math.hypot(this.positions[i * 3] - cx, this.positions[i * 3 + 1] - cy, this.positions[i * 3 + 2] - cz));
    }
    d.sort((a, b) => a - b);
    this.graphRadius = Math.max(60, d[Math.floor(d.length * 0.95)] ?? 60);
    this.sky.setRadius(this.graphRadius);
    this.sky.dust.position.set(cx, cy, cz);
  }

  private onWorker(msg: FromWorker) {
    if (msg.version !== this.version) return;
    if (msg.type === 'tick') {
      if (msg.positions.length !== this.positions.length) return;
      if (this.down?.gesture.pinned && this.down.node >= 0) {
        const i = this.down.node * 3;
        const keep = this.positions.slice(i, i + 3);
        this.positions.set(msg.positions);
        this.positions.set(keep, i);
      } else {
        this.positions.set(msg.positions);
      }
      this.positionsDirty = true;
      if (this.autoFit && ++this.ticksSinceFit % 12 === 0) {
        this.updateRadius();
        this.recenter(true);
      }
    } else if (msg.type === 'settled') {
      this.updateRadius();
      if (this.autoFit) {
        this.recenter(true);
        this.autoFit = false;
      }
      const out = new Map<string, number[]>();
      for (let i = 0; i < this.ids.length; i++) {
        const p = this.positions;
        out.set(this.ids[i], this.dims === 3 ? [round(p[i * 3]), round(p[i * 3 + 1]), round(p[i * 3 + 2])] : [round(p[i * 3]), round(p[i * 3 + 1])]);
      }
      this.emit('settled', out, this.dims);
    } else if (msg.type === 'clusters') {
      this.clusters = msg.assignment;
      this.summarizeClusters();
      this.recolor();
    }
  }

  private summarizeClusters() {
    const map = new Map<string, number>();
    const best = new Map<number, number>();
    const sizes = new Map<number, number>();
    const c = this.clusters!;
    for (let i = 0; i < c.length; i++) {
      map.set(this.ids[i], c[i]);
      if (c[i] < 0) continue;
      if (this.nodes[i].kind === 'note') sizes.set(c[i], (sizes.get(c[i]) ?? 0) + 1);
      else if (!sizes.has(c[i])) sizes.set(c[i], 0);
      const cur = best.get(c[i]);
      if (cur == null || this.degree[i] > this.degree[cur]) best.set(c[i], i);
    }
    const folders = new Map<number, Map<string, number>>();
    for (let i = 0; i < c.length; i++) {
      if (c[i] < 0 || this.nodes[i].kind !== 'note') continue;
      const top = this.nodes[i].folder.split('/')[0];
      if (!top) continue;
      const m = folders.get(c[i]) ?? new Map<string, number>();
      m.set(top, (m.get(top) ?? 0) + 1);
      folders.set(c[i], m);
    }
    this.clusterList = [...sizes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, size]) => {
        const hub = best.get(index)!;
        const [folder, count] = [...(folders.get(index) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
        const label = folder && count / size >= 0.6 ? folder : this.nodes[hub].title;
        return { index, size, hubId: this.ids[hub], hubTitle: label, color: CLUSTER_HUES[index % CLUSTER_HUES.length] };
      });
    this.rebuildClusterAnchors();
    this.emit('clusters', map, this.clusterList);
  }

  private rebuildClusterAnchors() {
    if (!this.clusters) {
      this.clusterAnchors = [];
      return;
    }
    this.clusterAnchors = computeClusterAnchors(this.positions, this.clusters, this.clusterList);
  }

  // ---------------------------------------------------------------- public controls

  setColorMode(mode: ColorMode) {
    if (mode === this.colorMode) return;
    this.colorMode = mode;
    this.recolor();
  }

  setDimension(dims: Dims) {
    if (dims === this.dims) return;
    this.dims = dims;
    this.post({ type: 'dims', dims });
    this.applyControlMode();
    const t = this.controls.getTarget(new THREE.Vector3());
    const r = this.graphRadius;
    if (dims === 2) this.controls.setLookAt(t.x, t.y, r * 2.6 + 80, t.x, t.y, 0, !this.reduced);
    else this.controls.setLookAt(t.x + r * 0.9, t.y + r * 0.5, r * 2.0 + 80, t.x, t.y, 0, !this.reduced);
    this.autoFit = true;
    this.ticksSinceFit = 0;
  }

  private applyControlMode() {
    const A = CameraControls.ACTION;
    const interactive = !this.ambient;
    this.controls.enabled = interactive;
    if (this.dims === 2) {
      this.controls.mouseButtons.left = A.TRUCK;
      this.controls.mouseButtons.right = A.TRUCK;
      this.controls.touches.one = A.TOUCH_TRUCK;
      this.controls.minPolarAngle = this.controls.maxPolarAngle = Math.PI / 2;
      this.controls.minAzimuthAngle = this.controls.maxAzimuthAngle = 0;
    } else {
      this.controls.mouseButtons.left = A.ROTATE;
      this.controls.mouseButtons.right = A.TRUCK;
      this.controls.touches.one = A.TOUCH_ROTATE;
      this.controls.minPolarAngle = 0.05;
      this.controls.maxPolarAngle = Math.PI - 0.05;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
    }
  }

  setAmbient(on: boolean) {
    this.ambient = on;
    this.dimTween.target = on ? 0.62 : 1;
    if (on) this.setHover(-1);
    this.applyControlMode();
    this.renderer.domElement.style.pointerEvents = on ? 'none' : 'auto';
  }

  setBloom(strength: number) {
    this.bloom.intensity = 1.35 * strength;
    this.sky.setIntensity(0.6 + strength * 0.4);
  }

  setLinkFlow(on: boolean) {
    this.linkFlow = on;
  }

  setGroupClusters(on: boolean) {
    if (on === this.groupClusters) return;
    this.groupClusters = on;
    this.post({ type: 'group', on });
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    this.controls.smoothTime = on ? 0 : 0.5;
  }

  /** Lights up a node and its neighbours hop by hop; null clears. */
  focus(id: string | null, depth: number, fly = true) {
    const i = id != null ? this.index.get(id) ?? -1 : -1;
    this.u.uFocusDepth.value = depth;
    if (i < 0) {
      this.focusIndex = -1;
      this.focusTween.target = 0;
      this.followFocus = false;
      return;
    }
    const sameNode = i === this.focusIndex && this.focusTween.target === 1;
    this.focusIndex = i;
    const hops = bfsHops(this.adjLinks, i, 3);
    for (let k = 0; k < hops.length; k++) this.nb.hop[k] = hops[k];
    for (let e = 0; e < this.src.length; e++) {
      const a = hops[this.src[e]];
      const b = hops[this.dst[e]];
      this.eb.hop[e * 2] = this.eb.hop[e * 2 + 1] = a >= 0 && b >= 0 ? Math.max(a, b) : -1;
    }
    this.nodeLayer.touch('hop');
    this.edgeLayer.touch('hop');
    if (!sameNode) this.u.uFocusTime.value = this.reduced ? 10 : 0;
    this.focusTween.target = 1;
    if (fly) this.flyTo(i, hops);
  }

  private flyTo(i: number, hops: Int16Array) {
    const p = new THREE.Vector3(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
    let reach = 0;
    for (let k = 0; k < hops.length; k++) {
      if (hops[k] === 1) {
        reach = Math.max(reach, Math.hypot(this.positions[k * 3] - p.x, this.positions[k * 3 + 1] - p.y, this.positions[k * 3 + 2] - p.z));
      }
    }
    const dist = THREE.MathUtils.clamp(reach * 2.4, 70, 900);
    const dir = this.camera.position.clone().sub(this.controls.getTarget(new THREE.Vector3()));
    if (this.dims === 2 || dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(dist);
    this.controls.setLookAt(p.x + dir.x, p.y + dir.y, p.z + dir.z, p.x, p.y, p.z, !this.reduced);
    this.userMoved = true;
    this.autoFit = false;
    this.followFocus = true;
  }

  /** Keeps a set of nodes lit (tag search, radar list) until cleared. */
  setHighlight(ids: string[] | null) {
    this.persistent = new Set((ids ?? []).map((id) => this.index.get(id)).filter((i): i is number => i != null));
    this.refreshHighlight();
  }

  findPath(fromId: string, toId: string): string[] | null {
    const a = this.index.get(fromId);
    const b = this.index.get(toId);
    if (a == null || b == null) return null;
    const p = shortestPath(this.adjLinks, a, b);
    return p ? p.map((i) => this.ids[i]) : null;
  }

  showPath(ids: string[] | null) {
    this.pathNodes = (ids ?? []).map((id) => this.index.get(id)).filter((i): i is number => i != null);
    this.refreshHighlight();
    if (this.pathNodes.length > 1) {
      this.beam.reveal = this.reduced ? 1 : 0;
      this.beamTween.value = this.beam.reveal;
      this.beamTween.target = 1;
      this.beam.update(this.positions, this.pathNodes, this.beamRadius());
      this.frameNodes(this.pathNodes);
    } else {
      this.beam.hide();
    }
  }

  private beamRadius() {
    return Math.max(0.8, this.graphRadius / 240);
  }

  private frameNodes(list: number[]) {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const i of list) box.expandByPoint(v.set(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(40, sphere.radius * 1.25);
    this.controls.fitToSphere(sphere, !this.reduced);
    this.userMoved = true;
    this.autoFit = false;
  }

  setTimelapse(active: boolean, opts: { playing?: boolean; speed?: number; t?: number } = {}) {
    const tl = this.timelapse;
    tl.active = active;
    if (opts.speed != null) tl.speed = opts.speed;
    if (opts.t != null) tl.t = opts.t;
    if (opts.playing != null) tl.playing = opts.playing;
    if (active && opts.t == null && opts.playing && tl.t >= 1.02) tl.t = 0;
    this.u.uTimelapseOn.value = active ? 1 : 0;
    this.u.uTimeCursor.value = tl.t;
    this.emit('timelapse', tl.t, tl.playing);
  }

  recenter(smooth = true) {
    const n = this.ids.length;
    if (!n) return;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      cx += this.positions[i * 3];
      cy += this.positions[i * 3 + 1];
      cz += this.positions[i * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    const r = this.graphRadius;
    const animate = smooth && !this.reduced;
    if (this.dims === 2) {
      this.controls.setLookAt(cx, cy, r * 2.5 + 60, cx, cy, 0, animate);
    } else {
      this.controls.fitToSphere(new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r * 1.08), animate);
    }
  }

  // ---------------------------------------------------------------- interaction

  private bindPointer() {
    const el = this.container;
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'none';

    el.addEventListener(
      'pointerdown',
      (e) => {
        if (this.ambient || e.button !== 0) return;
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const node = this.pick(x, y);
        const canDrag = node >= 0 && !e.shiftKey && !e.metaKey;
        this.down = { x, y, t: performance.now(), node, pointerId: e.pointerId, gesture: beginGesture(), cameraLocked: canDrag };
        if (!canDrag) return;
        this.controls.enabled = false;
        const p = new THREE.Vector3(this.positions[node * 3], this.positions[node * 3 + 1], this.positions[node * 3 + 2]);
        this.dragPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), p);
        el.setPointerCapture(e.pointerId);
        window.clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
          const d = this.down;
          if (!d || d.gesture.phase !== 'pending') return;
          d.gesture = advanceGesture(d.gesture, 0, CLICK_MS);
          this.releaseLockedCamera(d);
        }, CLICK_MS);
      },
      { capture: true },
    );

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.inside = true;
      const d = this.down;
      if (!d) {
        this.mouse.pending = true;
        return;
      }
      const moved = Math.hypot(this.mouse.x - d.x, this.mouse.y - d.y);
      const prev = d.gesture.phase;
      d.gesture = advanceGesture(d.gesture, moved, performance.now() - d.t);
      if (d.gesture.phase === 'hold') {
        this.releaseLockedCamera(d);
        return;
      }
      if (d.gesture.phase === 'drag' && d.cameraLocked && d.node >= 0) {
        if (prev !== 'drag') window.clearTimeout(this.holdTimer);
        const hit = this.worldAt(this.mouse.x, this.mouse.y);
        if (hit) {
          this.positions.set([hit.x, hit.y, this.dims === 3 ? hit.z : 0], d.node * 3);
          this.positionsDirty = true;
          this.post({ type: 'pin', index: d.node, x: hit.x, y: hit.y, z: hit.z });
        }
      }
    });

    const end = (e: PointerEvent) => {
      const d = this.down;
      if (!d) return;
      this.down = null;
      window.clearTimeout(this.holdTimer);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (e.type === 'pointercancel' && d.gesture.phase !== 'drag') d.gesture = { phase: 'hold', pinned: false };
      else d.gesture = advanceGesture(d.gesture, Math.hypot(this.mouse.x - d.x, this.mouse.y - d.y), performance.now() - d.t);
      this.releaseLockedCamera(d);
      if (d.gesture.pinned && d.node >= 0) this.post({ type: 'unpin', index: d.node });
      if (releaseGesture(d.gesture) === 'select') {
        const id = d.node >= 0 ? this.ids[d.node] : null;
        this.emit('select', id, { shift: e.shiftKey, meta: e.metaKey });
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    el.addEventListener('pointerleave', () => {
      this.mouse.inside = false;
      if (!this.down) this.setHover(-1);
    });
    el.addEventListener('dblclick', (e) => {
      if (this.ambient) return;
      const r = el.getBoundingClientRect();
      const node = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (node >= 0) this.emit('open', this.ids[node]);
    });
  }

  private worldAt(x: number, y: number) {
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());
  }

  /** Nearest node under a screen point, by projected disc; -1 for none. */
  private pick(x: number, y: number) {
    const e = this.vp.elements;
    const p = this.positions;
    const proj = this.camera.projectionMatrix.elements[5] * this.height * 0.5;
    let best = -1;
    let bestScore = Infinity;
    const timelapse = this.timelapse.active;
    const cursor = this.u.uTimeCursor.value;
    for (let i = 0; i < this.ids.length; i++) {
      if (timelapse && this.nb.birth[i] > cursor) continue;
      if (this.focusTween.target === 1 && (this.nb.hop[i] < 0 || this.nb.hop[i] > this.u.uFocusDepth.value)) continue;
      const px = p[i * 3];
      const py = p[i * 3 + 1];
      const pz = p[i * 3 + 2];
      const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
      if (w <= 0.1) continue;
      const sx = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w + 1) * 0.5 * this.width;
      const sy = (1 - (e[1] * px + e[5] * py + e[9] * pz + e[13]) / w) * 0.5 * this.height;
      const radius = Math.max(9, (this.nb.size[i] * proj) / w * 0.32);
      const d2 = (sx - x) ** 2 + (sy - y) ** 2;
      if (d2 > radius * radius) continue;
      const score = d2 / (radius * radius) + w * 1e-5;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private setHover(i: number) {
    if (i === this.hover) return;
    this.hover = i;
    this.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : '';
    this.refreshHighlight();
    this.emit('hover', i >= 0 ? this.ids[i] : null, this.mouse.x, this.mouse.y);
  }

  private refreshHighlight() {
    const hl = this.nb.highlight;
    const st = this.eb.state;
    hl.fill(0);
    st.fill(0);
    for (const i of this.persistent) hl[i] = 1;
    for (let k = 0; k < this.pathNodes.length; k++) {
      const i = this.pathNodes[k];
      hl[i] = 1;
      if (k > 0) {
        const e = this.edgeLookup.get(this.pathNodes[k - 1] * this.ids.length + i);
        if (e != null) st[e * 2] = st[e * 2 + 1] = 1;
      }
    }
    if (this.hover >= 0) {
      const h = this.hover;
      hl[h] = 1;
      for (let k = this.adjAll.offsets[h]; k < this.adjAll.offsets[h + 1]; k++) {
        const j = this.adjAll.neighbors[k];
        hl[j] = Math.max(hl[j], 0.55);
      }
      for (let k = this.incident.offsets[h]; k < this.incident.offsets[h + 1]; k++) {
        const e = this.incident.neighbors[k];
        st[e * 2] = st[e * 2 + 1] = 1;
      }
    }
    this.hoverTween.target = this.hover >= 0 || this.persistent.size > 0 || this.pathNodes.length > 0 ? 1 : 0;
    this.nodeLayer.touch('highlight');
    this.edgeLayer.touch('state');
  }

  // ---------------------------------------------------------------- frame loop

  /** Slides the picture sideways (fraction of the width) so text can sit beside the graph. */
  setViewShift(fraction: number) {
    this.viewShift = fraction;
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    if (this.viewShift) this.camera.setViewOffset(w, h, -w * this.viewShift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.u.uViewportH.value = h * this.renderer.getPixelRatio();
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    const minStep = this.ambient ? 1 / 30 : 0;
    if (this.acc < minStep) return;
    const step = this.acc;
    this.acc = 0;
    this.frame++;

    const u = this.u;
    u.uTime.value += step;
    u.uFocusTime.value += step;
    u.uFocusOn.value = this.focusTween.step(step, this.reduced);
    u.uHoverOn.value = this.hoverTween.step(step, this.reduced);
    u.uDim.value = this.dimTween.step(step, this.reduced);
    u.uFlow.value = this.linkFlow && !this.reduced ? 1 : 0;

    const tl = this.timelapse;
    if (tl.active && tl.playing) {
      tl.t = Math.min(1.02, tl.t + (step * tl.speed) / TIMELAPSE_SECONDS);
      u.uTimeCursor.value = tl.t;
      if (tl.t >= 1.02) tl.playing = false;
      if (now - tl.lastEmit > 90 || !tl.playing) {
        tl.lastEmit = now;
        this.emit('timelapse', tl.t, tl.playing);
      }
    }

    if (this.ambient && this.dims === 3 && !this.reduced) this.controls.rotate(step * 0.035, 0, false);
    if (!this.ambient && tl.active && tl.playing && this.dims === 3 && !this.reduced && !this.down) this.controls.rotate(step * 0.06, 0, false);
    this.controls.update(step);

    const dist = this.controls.distance;
    u.uFogNear.value = dist * 0.75;
    u.uFogFar.value = dist * 2.8 + this.graphRadius;

    if (this.positionsDirty) {
      this.writeEdgePositions();
      this.rebuildClusterAnchors();
      this.positionsDirty = false;
      if (this.followFocus && this.focusIndex >= 0 && !this.down) {
        const f = this.focusIndex * 3;
        this.controls.moveTo(this.positions[f], this.positions[f + 1], this.positions[f + 2], !this.reduced);
      }
      if (this.pathNodes.length > 1 && this.frame % 8 === 0) this.beam.update(this.positions, this.pathNodes, this.beamRadius());
    }
    if (this.pathNodes.length > 1) this.beam.reveal = this.beamTween.step(step, this.reduced);

    this.sky.far.position.copy(this.camera.position);
    this.camera.updateMatrixWorld();
    this.vp.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);

    if (this.mouse.pending && !this.down && !this.ambient) {
      this.mouse.pending = false;
      this.setHover(this.mouse.inside ? this.pick(this.mouse.x, this.mouse.y) : -1);
    }
    if (this.interacting || this.down || this.frame % 2 === 0) this.updateLabels();
    this.updateClusterLabels();

    this.composer.render(step);

    this.fpsFrames++;
    this.fpsTime += step;
    if (this.fpsTime >= 1) {
      this.emit('fps', Math.round(this.fpsFrames / this.fpsTime));
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  };

  private project(i: number): [number, number, number] | null {
    return this.projectPoint(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
  }

  private projectPoint(px: number, py: number, pz: number): [number, number, number] | null {
    const e = this.vp.elements;
    const w = e[3] * px + e[7] * py + e[11] * pz + e[15];
    if (w <= 0.1) return null;
    const sx = ((e[0] * px + e[4] * py + e[8] * pz + e[12]) / w + 1) * 0.5 * this.width;
    const sy = (1 - (e[1] * px + e[5] * py + e[9] * pz + e[13]) / w) * 0.5 * this.height;
    if (sx < -80 || sy < -80 || sx > this.width + 80 || sy > this.height + 80) return null;
    return [sx, sy, w];
  }

  private visible(i: number) {
    if (this.timelapse.active && this.nb.birth[i] > this.u.uTimeCursor.value) return false;
    if (this.focusTween.target === 1) {
      const h = this.nb.hop[i];
      if (h < 0 || h > this.u.uFocusDepth.value) return false;
    }
    return true;
  }

  private updateLabels() {
    if (this.ambient) {
      this.labels.render([]);
      return;
    }
    const want: { i: number; kind: LabelKind }[] = [];
    const seen = new Set<number>();
    const add = (i: number, kind: LabelKind) => {
      if (i < 0 || seen.has(i) || !this.visible(i)) return;
      seen.add(i);
      want.push({ i, kind });
    };
    add(this.hover, 'hover');
    add(this.focusIndex, 'focus');
    this.pathNodes.forEach((i) => add(i, 'path'));
    if (this.focusIndex >= 0 && this.focusTween.target === 1) {
      const near: number[] = [];
      for (let k = 0; k < this.nb.hop.length; k++) if (this.nb.hop[k] === 1) near.push(k);
      near.sort((a, b) => this.degree[b] - this.degree[a]).slice(0, 18).forEach((i) => add(i, 'neighbor'));
    }
    [...this.persistent].slice(0, 30).forEach((i) => add(i, 'highlight'));
    const hubLimit = this.ambient ? 0 : this.focusIndex >= 0 ? 8 : 22;
    this.hubs.slice(0, hubLimit).forEach((i) => add(i, 'hub'));

    const proj = this.camera.projectionMatrix.elements[5] * this.height * 0.5;
    const placed: PlacedLabel[] = [];
    const boxes: [number, number, number, number][] = [];
    for (const { i, kind } of want) {
      const s = this.project(i);
      if (!s) continue;
      const [x, y, w] = s;
      const sizePx = (this.nb.size[i] * proj) / w;
      if (kind === 'hub' && sizePx < 9) continue;
      const text = this.nodes[i].title;
      const width = Math.min(220, text.length * 6.8 + 16);
      const top = y - sizePx * 0.32 - 22;
      const box: [number, number, number, number] = [x - width / 2, top, x + width / 2, top + 20];
      const priority = kind !== 'hub' && kind !== 'neighbor';
      if (!priority && boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      const fog = THREE.MathUtils.smoothstep(w, this.u.uFogNear.value, this.u.uFogFar.value);
      const alpha = (kind === 'hub' ? 0.78 : 1) * (1 - fog * 0.7) * Math.max(0.35, this.u.uDim.value);
      placed.push({ key: i, x, y: top, text, kind, alpha });
      if (placed.length >= 48) break;
    }
    this.labels.render(placed);
  }

  private updateClusterLabels() {
    const show =
      !this.ambient &&
      this.colorMode === 'cluster' &&
      this.clusters &&
      this.focusTween.target === 0 &&
      this.pathNodes.length === 0 &&
      this.persistent.size === 0 &&
      !this.timelapse.active &&
      this.controls.distance > this.graphRadius * 1.1;
    if (!show) {
      this.labels.renderClusters([]);
      return;
    }
    const infoBy = new Map(this.clusterList.map((c) => [c.index, c]));
    const proj = this.camera.projectionMatrix.elements[5] * this.height * 0.5;
    const items: PlacedCluster[] = [];
    const boxes: [number, number, number, number][] = [];
    const ranked = [...this.clusterAnchors].sort((a, b) => (infoBy.get(b.index)?.size ?? 0) - (infoBy.get(a.index)?.size ?? 0));
    for (const anchor of ranked) {
      const info = infoBy.get(anchor.index);
      if (!info) continue;
      const s = this.projectPoint(anchor.x, anchor.y, anchor.z);
      if (!s) continue;
      const [cx, cy, w] = s;
      const lift = (anchor.radius * proj) / w;
      const x = cx;
      const y = cy - lift - 28;
      if (y < 90 || x < 0 || x > this.width) continue;
      const width = info.hubTitle.length * 9 + 24;
      const box: [number, number, number, number] = [x - width / 2, y - 40, x + width / 2, y];
      if (boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
      boxes.push(box);
      items.push({ key: info.index, x, y, text: info.hubTitle, count: info.size, color: info.color, alpha: 0.92 });
    }
    this.labels.renderClusters(items);
  }

  private releaseLockedCamera(d: { cameraLocked: boolean }) {
    if (!d.cameraLocked) return;
    d.cameraLocked = false;
    this.applyControlMode();
  }

  dispose() {
    window.clearTimeout(this.holdTimer);
    cancelAnimationFrame(this.raf);
    this.post({ type: 'stop' });
    this.worker.terminate();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.nodeLayer.dispose();
    this.edgeLayer.dispose();
    this.sky.dispose();
    this.beam.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.dispose();
    this.listeners = {};
  }
}

function round(v: number) {
  return Math.round(v * 10) / 10;
}

import {
  AddEquation,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CustomBlending,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  Mesh,
  OneFactor,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  type IUniform,
} from 'three';
import {
  BEAM_FRAG,
  BEAM_VERT,
  DUST_FRAG,
  DUST_VERT,
  EDGE_FRAG,
  EDGE_VERT,
  NODE_FRAG,
  NODE_VERT,
  SKY_FRAG,
  SKY_VERT,
  STAR_FRAG,
  STAR_VERT,
} from './shaders';

export const ADDITIVE = {
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendEquation: AddEquation,
} as const;

export type Uniforms = Record<string, IUniform>;

export interface NodeBuffers {
  offset: Float32Array;
  color: Float32Array;
  size: Float32Array;
  kind: Float32Array;
  birth: Float32Array;
  hop: Float32Array;
  highlight: Float32Array;
  pulse: Float32Array;
}

const NODE_ATTRS: [keyof NodeBuffers, string, number][] = [
  ['offset', 'aOffset', 3],
  ['color', 'aColor', 3],
  ['size', 'aSize', 1],
  ['kind', 'aKind', 1],
  ['birth', 'aBirth', 1],
  ['hop', 'aHop', 1],
  ['highlight', 'aHighlight', 1],
  ['pulse', 'aPulse', 1],
];

export function allocNodes(n: number): NodeBuffers {
  return {
    offset: new Float32Array(n * 3),
    color: new Float32Array(n * 3),
    size: new Float32Array(n),
    kind: new Float32Array(n),
    birth: new Float32Array(n),
    hop: new Float32Array(n).fill(-1),
    highlight: new Float32Array(n),
    pulse: new Float32Array(n).fill(-1000),
  };
}

export class NodeLayer {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private attrs = new Map<keyof NodeBuffers, InstancedBufferAttribute>();
  private plane = new PlaneGeometry(1, 1);

  constructor(uniforms: Uniforms) {
    const material = new ShaderMaterial({ uniforms, vertexShader: NODE_VERT, fragmentShader: NODE_FRAG, ...ADDITIVE });
    this.mesh = new Mesh(new InstancedBufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  setBuffers(b: NodeBuffers, count: number) {
    const old = this.mesh.geometry;
    const g = new InstancedBufferGeometry();
    g.index = this.plane.index;
    g.setAttribute('position', this.plane.getAttribute('position'));
    g.setAttribute('uv', this.plane.getAttribute('uv'));
    this.attrs.clear();
    for (const [key, name, size] of NODE_ATTRS) {
      const attr = new InstancedBufferAttribute(b[key], size);
      attr.setUsage(DynamicDrawUsage);
      g.setAttribute(name, attr);
      this.attrs.set(key, attr);
    }
    g.instanceCount = count;
    this.mesh.geometry = g;
    old.dispose();
  }

  touch(...keys: (keyof NodeBuffers)[]) {
    for (const k of keys) {
      const a = this.attrs.get(k);
      if (a) a.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.plane.dispose();
  }
}

export interface EdgeBuffers {
  position: Float32Array;
  color: Float32Array;
  t: Float32Array;
  seed: Float32Array;
  kind: Float32Array;
  state: Float32Array;
  birth: Float32Array;
  born: Float32Array;
  hop: Float32Array;
}

const EDGE_ATTRS: [keyof EdgeBuffers, string, number][] = [
  ['position', 'position', 3],
  ['color', 'aColor', 3],
  ['t', 'aT', 1],
  ['seed', 'aSeed', 1],
  ['kind', 'aKind', 1],
  ['state', 'aState', 1],
  ['birth', 'aBirth', 1],
  ['born', 'aBorn', 1],
  ['hop', 'aHop', 1],
];

export function allocEdges(m: number): EdgeBuffers {
  const v = m * 2;
  return {
    position: new Float32Array(v * 3),
    color: new Float32Array(v * 3),
    t: new Float32Array(v),
    seed: new Float32Array(v),
    kind: new Float32Array(v),
    state: new Float32Array(v),
    birth: new Float32Array(v),
    born: new Float32Array(v).fill(-1000),
    hop: new Float32Array(v).fill(-1),
  };
}

export class EdgeLayer {
  readonly lines: LineSegments<BufferGeometry, ShaderMaterial>;
  private attrs = new Map<keyof EdgeBuffers, BufferAttribute>();

  constructor(uniforms: Uniforms) {
    const material = new ShaderMaterial({ uniforms, vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG, ...ADDITIVE });
    this.lines = new LineSegments(new BufferGeometry(), material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
  }

  setBuffers(b: EdgeBuffers) {
    const old = this.lines.geometry;
    const g = new BufferGeometry();
    this.attrs.clear();
    for (const [key, name, size] of EDGE_ATTRS) {
      const attr = new BufferAttribute(b[key], size);
      attr.setUsage(DynamicDrawUsage);
      g.setAttribute(name, attr);
      this.attrs.set(key, attr);
    }
    this.lines.geometry = g;
    old.dispose();
  }

  touch(...keys: (keyof EdgeBuffers)[]) {
    for (const k of keys) {
      const a = this.attrs.get(k);
      if (a) a.needsUpdate = true;
    }
  }

  dispose() {
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nebula backdrop, a far star field that follows the camera, and near dust for parallax. */
export class SkyLayer {
  readonly far = new Group();
  readonly dust: Points<BufferGeometry, ShaderMaterial>;
  private skyMaterial: ShaderMaterial;
  private starMaterial: ShaderMaterial;

  constructor(time: IUniform, pixelRatio: IUniform, viewportH: IUniform) {
    const rand = mulberry(9);
    this.skyMaterial = new ShaderMaterial({
      uniforms: { uTime: time, uIntensity: { value: 1 } },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
    });
    const sky = new Mesh(new SphereGeometry(5000, 48, 24), this.skyMaterial);
    sky.renderOrder = -2;
    sky.frustumCulled = false;
    this.far.add(sky);

    const count = 3200;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const tints = [new Color('#ffffff'), new Color('#c9b6ff'), new Color('#9fe9ff'), new Color('#ffd5f9')];
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(th) * 4200, u * 4200, r * Math.sin(th) * 4200], i * 3);
      const bright = Math.pow(rand(), 6);
      size[i] = 0.8 + bright * 3.2;
      phase[i] = rand();
      const c = tints[Math.floor(rand() * tints.length)];
      const k = 0.35 + bright * 0.9;
      color.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new BufferAttribute(size, 1));
    sg.setAttribute('aPhase', new BufferAttribute(phase, 1));
    sg.setAttribute('aColor', new BufferAttribute(color, 3));
    this.starMaterial = new ShaderMaterial({
      uniforms: { uTime: time, uPixelRatio: pixelRatio },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      ...ADDITIVE,
    });
    const stars = new Points(sg, this.starMaterial);
    stars.renderOrder = -1;
    stars.frustumCulled = false;
    this.far.add(stars);

    const dustCount = 900;
    const dpos = new Float32Array(dustCount * 3);
    const dsize = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const r = Math.cbrt(rand());
      const s = Math.sqrt(1 - u * u);
      dpos.set([s * Math.cos(th) * r, u * r, s * Math.sin(th) * r], i * 3);
      dsize[i] = 0.6 + rand() * 1.6;
    }
    const dg = new BufferGeometry();
    dg.setAttribute('position', new BufferAttribute(dpos, 3));
    dg.setAttribute('aSize', new BufferAttribute(dsize, 1));
    this.dust = new Points(
      dg,
      new ShaderMaterial({
        uniforms: { uPixelRatio: pixelRatio, uViewportH: viewportH, uColor: { value: new Color('#b9a6ff') } },
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        ...ADDITIVE,
      }),
    );
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 0;
  }

  setRadius(r: number) {
    this.dust.scale.setScalar(Math.max(300, r * 1.7));
  }

  setIntensity(v: number) {
    this.skyMaterial.uniforms.uIntensity.value = v;
  }

  dispose() {
    this.far.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      (m.material as ShaderMaterial | undefined)?.dispose?.();
    });
    this.dust.geometry.dispose();
    this.dust.material.dispose();
  }
}

/** A glowing tube that draws itself along the chain of notes a path finder found. */
export class PathBeam {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private points: Vector3[] = [];

  constructor(time: IUniform) {
    this.mesh = new Mesh(
      new BufferGeometry(),
      new ShaderMaterial({
        uniforms: {
          uTime: time,
          uReveal: { value: 0 },
          uFrom: { value: new Color('#5eeaf7') },
          uTo: { value: new Color('#f062f5') },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        ...ADDITIVE,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  get reveal() {
    return this.mesh.material.uniforms.uReveal.value as number;
  }
  set reveal(v: number) {
    this.mesh.material.uniforms.uReveal.value = v;
  }

  update(positions: Float32Array, path: number[], radius: number) {
    if (path.length < 2) {
      this.mesh.visible = false;
      return;
    }
    if (this.points.length !== path.length) this.points = path.map(() => new Vector3());
    path.forEach((i, k) => this.points[k].set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
    const curve = new CatmullRomCurve3(this.points, false, 'centripetal');
    const old = this.mesh.geometry;
    this.mesh.geometry = new TubeGeometry(curve, Math.max(24, path.length * 28), radius, 8, false);
    old.dispose();
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

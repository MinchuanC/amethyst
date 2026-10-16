import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  forceZ,
  type Force,
  type SimLink,
  type SimNode,
  type Simulation,
} from 'd3-force-3d';
import { clusterNodes } from './analysis';
import type { Dims, FromWorker, ToWorker } from './layoutProtocol';

interface Node extends SimNode {
  cluster: number;
}

const ctx = self as unknown as Worker;
const post = (msg: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer);

let sim: Simulation<Node> | null = null;
let nodes: Node[] = [];
let version = 0;
let dims: Dims = 3;
let timer: ReturnType<typeof setTimeout> | undefined;
let groupOn = true;
let clusterSizes = new Map<number, number>();

const TICK_BUDGET_MS = 9;
const FRAME_MS = 16;

function clusterForce(strength: number): Force<Node> {
  let ns: Node[] = [];
  const force = (alpha: number) => {
    const cx = new Map<number, [number, number, number, number]>();
    for (const n of ns) {
      if (n.cluster < 0) continue;
      const c = cx.get(n.cluster) ?? [0, 0, 0, 0];
      c[0] += n.x!;
      c[1] += n.y!;
      c[2] += n.z ?? 0;
      c[3] += 1;
      cx.set(n.cluster, c);
    }
    const k = strength * alpha;
    for (const n of ns) {
      if (n.cluster < 0 || (clusterSizes.get(n.cluster) ?? 0) < 3) continue;
      const c = cx.get(n.cluster)!;
      n.vx! += (c[0] / c[3] - n.x!) * k;
      n.vy! += (c[1] / c[3] - n.y!) * k;
      if (dims === 3) n.vz! += (c[2] / c[3] - (n.z ?? 0)) * k;
    }
  };
  force.initialize = (n: Node[]) => {
    ns = n;
  };
  return force;
}

function applyDimensionForces() {
  if (!sim) return;
  const pull = 0.014;
  sim.force('x', forceX<Node>(0).strength(pull));
  sim.force('y', forceY<Node>(0).strength(pull));
  sim.force('z', dims === 3 ? forceZ<Node>(0).strength(pull) : null);
  sim.force('cluster', groupOn ? clusterForce(0.06) : null);
}

function loop() {
  if (!sim) return;
  const start = performance.now();
  do {
    sim.tick();
  } while (performance.now() - start < TICK_BUDGET_MS && sim.alpha() > sim.alphaMin());
  const positions = new Float32Array(nodes.length * 3);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    positions[i * 3] = n.x ?? 0;
    positions[i * 3 + 1] = n.y ?? 0;
    positions[i * 3 + 2] = dims === 3 ? n.z ?? 0 : 0;
  }
  post({ type: 'tick', version, positions, alpha: sim.alpha() }, [positions.buffer]);
  if (sim.alpha() <= sim.alphaMin() && sim.alphaTarget() === 0) {
    post({ type: 'settled', version });
    timer = undefined;
    return;
  }
  timer = setTimeout(loop, FRAME_MS);
}

function kick() {
  if (timer === undefined) timer = setTimeout(loop, 0);
}

ctx.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init': {
      clearTimeout(timer);
      timer = undefined;
      version = msg.version;
      dims = msg.dims;
      groupOn = msg.groupClusters;
      const clusters = clusterNodes(msg.n, msg.src, msg.dst);
      clusterSizes = new Map();
      for (const c of clusters) if (c >= 0) clusterSizes.set(c, (clusterSizes.get(c) ?? 0) + 1);
      post({ type: 'clusters', version, assignment: clusters.slice() });

      nodes = Array.from({ length: msg.n }, (_, i): Node => {
        const n: Node = { cluster: clusters[i] };
        if (msg.known[i]) {
          n.x = msg.positions[i * 3];
          n.y = msg.positions[i * 3 + 1];
          n.z = dims === 3 ? msg.positions[i * 3 + 2] : 0;
        }
        return n;
      });
      const degree = new Uint32Array(msg.n);
      const links: SimLink<Node>[] = [];
      for (let e = 0; e < msg.src.length; e++) {
        if (!msg.springs[e] || msg.src[e] === msg.dst[e]) continue;
        links.push({ source: msg.src[e], target: msg.dst[e] });
        degree[msg.src[e]]++;
        degree[msg.dst[e]]++;
      }
      const charge = -Math.max(16, 72 - Math.sqrt(msg.n) * 0.9);
      sim = forceSimulation<Node>(nodes, dims)
        .alpha(msg.alpha)
        .alphaMin(0.004)
        .alphaDecay(0.0205)
        .velocityDecay(0.36)
        .force(
          'link',
          forceLink<Node, SimLink<Node>>(links)
            .distance((l) => {
              const a = degree[(l.source as Node).index!];
              const b = degree[(l.target as Node).index!];
              return 26 + Math.min(40, Math.sqrt(Math.min(a, b)) * 6);
            })
            .iterations(1),
        )
        .force('charge', forceManyBody<Node>().strength(charge).theta(0.92).distanceMax(1400))
        .stop();
      applyDimensionForces();
      kick();
      break;
    }
    case 'dims': {
      if (!sim || msg.dims === dims) return;
      dims = msg.dims;
      for (const n of nodes) {
        if (dims === 2) {
          n.z = 0;
          n.vz = 0;
        } else {
          n.z = (Math.random() - 0.5) * 60;
          n.vz = 0;
        }
      }
      sim.numDimensions(dims);
      applyDimensionForces();
      sim.alpha(0.9);
      kick();
      break;
    }
    case 'group': {
      groupOn = msg.on;
      applyDimensionForces();
      sim?.alpha(Math.max(sim.alpha(), 0.4));
      kick();
      break;
    }
    case 'pin': {
      const n = nodes[msg.index];
      if (!n || !sim) return;
      n.fx = msg.x;
      n.fy = msg.y;
      n.fz = dims === 3 ? msg.z : 0;
      sim.alphaTarget(0.18);
      if (sim.alpha() < 0.18) sim.alpha(0.18);
      kick();
      break;
    }
    case 'unpin': {
      const n = nodes[msg.index];
      if (!n || !sim) return;
      n.fx = null;
      n.fy = null;
      n.fz = null;
      sim.alphaTarget(0);
      kick();
      break;
    }
    case 'reheat': {
      if (!sim) return;
      sim.alpha(Math.max(sim.alpha(), msg.alpha));
      kick();
      break;
    }
    case 'stop': {
      clearTimeout(timer);
      timer = undefined;
      sim = null;
      break;
    }
  }
};

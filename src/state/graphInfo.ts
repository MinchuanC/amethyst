import { create } from 'zustand';

export interface ClusterInfo {
  index: number;
  size: number;
  label: string;
  hubId: string;
  color: string;
}

interface GraphInfoStore {
  /** Cluster index per node id; -1 for nodes with no community. */
  clusters: Map<string, number>;
  clusterList: ClusterInfo[];
  /** CSS color per node id for the current color mode. */
  colors: Map<string, string>;
  fps: number;
  settled: boolean;
  timelapseT: number;
  timelapsePlaying: boolean;
  set(partial: Partial<Omit<GraphInfoStore, 'set'>>): void;
}

export const useGraphInfo = create<GraphInfoStore>((set) => ({
  clusters: new Map(),
  clusterList: [],
  colors: new Map(),
  fps: 0,
  settled: false,
  timelapseT: 1,
  timelapsePlaying: false,
  set: (partial) => set(partial),
}));

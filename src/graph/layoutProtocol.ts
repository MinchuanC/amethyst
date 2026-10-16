export type Dims = 2 | 3;

export type ToWorker =
  | {
      type: 'init';
      version: number;
      n: number;
      positions: Float32Array;
      /** 1 where `positions` holds a real position; 0 lets the simulation place the node. */
      known: Uint8Array;
      src: Uint32Array;
      dst: Uint32Array;
      /** 1 for links that should pull nodes together (not ghost links). */
      springs: Uint8Array;
      dims: Dims;
      alpha: number;
      groupClusters: boolean;
    }
  | { type: 'dims'; dims: Dims }
  | { type: 'group'; on: boolean }
  | { type: 'pin'; index: number; x: number; y: number; z: number }
  | { type: 'unpin'; index: number }
  | { type: 'reheat'; alpha: number }
  | { type: 'stop' };

export type FromWorker =
  | { type: 'tick'; version: number; positions: Float32Array; alpha: number }
  | { type: 'settled'; version: number }
  | { type: 'clusters'; version: number; assignment: Int32Array };

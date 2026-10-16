import { create } from 'zustand';

interface GraphHoverStore {
  id: string | null;
  x: number;
  y: number;
  set(id: string | null, x: number, y: number): void;
}

export const useGraphHover = create<GraphHoverStore>((set) => ({
  id: null,
  x: 0,
  y: 0,
  set: (id, x, y) => set({ id, x, y }),
}));

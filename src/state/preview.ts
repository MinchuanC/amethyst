import { create } from 'zustand';

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PreviewStore {
  path: string | null;
  anchor: AnchorRect | null;
  show(path: string, anchor: AnchorRect): void;
  /** Hides after a short grace period, so the pointer can move onto the popover. */
  scheduleHide(): void;
  keep(): void;
  hide(): void;
}

let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export const usePreview = create<PreviewStore>((set) => ({
  path: null,
  anchor: null,
  show(path, anchor) {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => set({ path, anchor }), 320);
  },
  scheduleHide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => set({ path: null, anchor: null }), 260);
  },
  keep() {
    clearTimeout(hideTimer);
  },
  hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    set({ path: null, anchor: null });
  },
}));

export function rectOf(el: Element): AnchorRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

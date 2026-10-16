/** A short still release selects. Movement before this window drags the node. */
export const CLICK_MS = 500;
/** Trackpad noise stays under this. Past it, before the hold window, the node is pinned. */
export const DRAG_PX = 8;

export type GesturePhase = 'pending' | 'drag' | 'hold';

export interface Gesture {
  phase: GesturePhase;
  /** True only after an intentional drag. A hold must never pin. */
  pinned: boolean;
}

export function beginGesture(): Gesture {
  return { phase: 'pending', pinned: false };
}

/**
 * Advance a press. Once 500ms passes without a drag, the gesture locks as a
 * hold: later jitter cannot pin the node or count as a click.
 */
export function advanceGesture(gesture: Gesture, movedPx: number, heldMs: number): Gesture {
  if (gesture.phase === 'hold') return { phase: 'hold', pinned: false };
  if (gesture.phase === 'drag') return { phase: 'drag', pinned: true };
  if (heldMs >= CLICK_MS) return { phase: 'hold', pinned: false };
  if (movedPx > DRAG_PX) return { phase: 'drag', pinned: true };
  return { phase: 'pending', pinned: false };
}

export function releaseGesture(gesture: Gesture): 'select' | 'none' {
  return gesture.phase === 'pending' ? 'select' : 'none';
}

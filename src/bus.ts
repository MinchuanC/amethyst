/** Imperative one-off requests between distant components (e.g. palette -> graph). */
export type BusEvent = 'graph:recenter' | 'search:focus' | 'editor:focus';

const listeners = new Map<BusEvent, Set<() => void>>();

export const bus = {
  on(event: BusEvent, cb: () => void) {
    const set = listeners.get(event) ?? new Set();
    set.add(cb);
    listeners.set(event, set);
    return () => {
      set.delete(cb);
    };
  },
  emit(event: BusEvent) {
    listeners.get(event)?.forEach((cb) => cb());
  },
};

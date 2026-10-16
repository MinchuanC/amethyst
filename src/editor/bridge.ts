/**
 * Lets non-editor code tell the editor about renames before the workspace
 * switches paths, without importing the editor (which imports the stores).
 */
const renames = new Map<string, string>();

export function noteRenamed(from: string, to: string) {
  renames.set(from, to);
}

/** Consumes a pending rename from `from`, returning its new path. */
export function takeRename(from: string): string | undefined {
  const to = renames.get(from);
  renames.delete(from);
  return to;
}

let flusher: (() => Promise<void>) | null = null;

export function registerFlush(fn: (() => Promise<void>) | null) {
  flusher = fn;
}

/** Writes any unsaved edits now. */
export async function flushEditor() {
  await flusher?.();
}

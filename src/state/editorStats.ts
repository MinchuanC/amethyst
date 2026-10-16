import { create } from 'zustand';

interface EditorStatsStore {
  path: string | null;
  words: number;
  characters: number;
  set(path: string, text: string): void;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function countWords(text: string) {
  const body = text.replace(FRONTMATTER, '');
  const words = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return { words: words?.length ?? 0, characters: body.replace(/\s/g, '').length };
}

/** Live counts for the note open in the editor. */
export const useEditorStats = create<EditorStatsStore>((set) => ({
  path: null,
  words: 0,
  characters: 0,
  set: (path, text) => set({ path, ...countWords(text) }),
}));

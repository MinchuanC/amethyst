import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { LinkTarget } from '../api/types';

export interface CompletionSources {
  targets: () => LinkTarget[];
  tags: () => string[];
}

const isNote = (p: string) => /\.md$/i.test(p);

function linkTextFor(t: LinkTarget, titleCounts: Map<string, number>) {
  if ((titleCounts.get(t.title.toLowerCase()) ?? 0) > 1) return isNote(t.path) ? t.path.replace(/\.md$/i, '') : t.path;
  return t.title;
}

function applyLink(text: string) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const closing = view.state.sliceDoc(to, to + 2) === ']]';
    const insert = closing ? text : `${text}]]`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length + (closing ? 2 : 0) },
    });
  };
}

export function vaultCompletions(src: CompletionSources) {
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const link = ctx.matchBefore(/\[\[[^[\]\n]*$/);
    if (link) {
      const query = link.text.slice(2);
      if (query.includes('|')) return null;
      const targets = src.targets();
      const hash = query.indexOf('#');
      if (hash >= 0) {
        const name = query.slice(0, hash).trim().toLowerCase();
        const t = targets.find((x) => x.title.toLowerCase() === name || x.path.toLowerCase().replace(/\.md$/, '') === name);
        if (!t) return null;
        return {
          from: link.from + 2 + hash + 1,
          options: t.headings.map((h) => ({ label: h, detail: 'heading', apply: applyLink(h) })),
          validFor: /^[^[\]\n|]*$/,
        };
      }
      const counts = new Map<string, number>();
      for (const t of targets) counts.set(t.title.toLowerCase(), (counts.get(t.title.toLowerCase()) ?? 0) + 1);
      const options: Completion[] = [];
      for (const t of targets) {
        const text = linkTextFor(t, counts);
        const folder = t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/')) : '';
        options.push({
          label: isNote(t.path) ? t.title : t.path.split('/').pop()!,
          detail: folder || undefined,
          apply: applyLink(isNote(t.path) ? text : t.path.split('/').pop()!),
          boost: isNote(t.path) ? 0 : -20,
        });
        for (const alias of t.aliases) {
          options.push({ label: alias, detail: `alias of ${t.title}`, apply: applyLink(`${text}|${alias}`), boost: -5 });
        }
      }
      return { from: link.from + 2, options, validFor: /^[^[\]\n|#]*$/ };
    }

    const tag = ctx.matchBefore(/(?:^|\s)#[\p{L}\p{N}\p{M}_/-]*$/u);
    if (tag) {
      const start = tag.from + tag.text.indexOf('#') + 1;
      const word = ctx.state.sliceDoc(start, ctx.pos);
      if (!word && !ctx.explicit) return null;
      return {
        from: start,
        options: src.tags().map((t) => ({ label: t, detail: 'tag' })),
        validFor: /^[\p{L}\p{N}\p{M}_/-]*$/u,
      };
    }
    return null;
  };

  return autocompletion({ override: [source], icons: false, maxRenderedOptions: 80 });
}

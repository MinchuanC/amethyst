import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, type EditorState, type Extension } from '@codemirror/state';

const CODE_NODES = new Set(['FencedCode', 'InlineCode', 'CodeBlock', 'CodeText']);

/** True when `pos` sits inside code, where [[links]] and #tags are literal text. */
export function inCode(state: EditorState, pos: number) {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (CODE_NODES.has(node.name)) return true;
  }
  return false;
}

/** Dispatch to re-check which links resolve after the vault changes. */
export const refreshLinks = StateEffect.define<null>();
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

export const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
export const TAG_RE = /(^|\s)(#[\p{L}\p{N}\p{M}_/-]*[\p{L}\p{M}_][\p{L}\p{N}\p{M}_/-]*)/gu;

export function linkTarget(inner: string) {
  return inner.split('|')[0].replace(/\\$/, '').split('#')[0].trim();
}

export interface WikilinkOptions {
  onFollow: (target: string, newTab: boolean) => void;
  isResolved: (target: string) => boolean;
  /** In live preview, a plain click on a rendered link follows it. */
  plainClickFollows: (view: EditorView, pos: number) => boolean;
}

function frontmatterEnd(view: EditorView) {
  const doc = view.state.doc;
  if (doc.lines < 2 || doc.line(1).text !== '---') return 0;
  for (let i = 2; i <= Math.min(doc.lines, 200); i++) {
    const text = doc.line(i).text;
    if (text === '---' || text === '...') return doc.line(i).to;
  }
  return 0;
}

function build(view: EditorView, opts: WikilinkOptions): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const fmEnd = frontmatterEnd(view);
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  if (fmEnd > 0) {
    const doc = view.state.doc;
    const last = doc.lineAt(fmEnd).number;
    for (let i = 1; i <= last; i++) {
      const line = doc.line(i);
      const fence = i === 1 || i === last;
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: fence ? 'cm-frontmatter cm-frontmatter-fence' : 'cm-frontmatter' }) });
    }
  }
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    for (const m of text.matchAll(WIKILINK_RE)) {
      const start = from + m.index!;
      if (start < fmEnd || inCode(view.state, start)) continue;
      const target = linkTarget(m[2]);
      const cls = ['cm-wikilink'];
      if (m[1]) cls.push('cm-wikilink-embed');
      if (target && !opts.isResolved(target)) cls.push('cm-wikilink-unresolved');
      marks.push({
        from: start,
        to: start + m[0].length,
        deco: Decoration.mark({ class: cls.join(' '), attributes: { 'data-target': target } }),
      });
    }
    for (const m of text.matchAll(TAG_RE)) {
      const start = from + m.index! + m[1].length;
      if (start < fmEnd || inCode(view.state, start)) continue;
      marks.push({ from: start, to: start + m[2].length, deco: Decoration.mark({ class: 'cm-tag' }) });
    }
    for (const m of text.matchAll(/==([^=\n]+)==/g)) {
      const start = from + m.index!;
      if (start < fmEnd || inCode(view.state, start)) continue;
      marks.push({ from: start, to: start + m[0].length, deco: Decoration.mark({ class: 'cm-highlight' }) });
    }
    for (const m of text.matchAll(/%%[\s\S]*?%%/g)) {
      const start = from + m.index!;
      if (start < fmEnd || inCode(view.state, start)) continue;
      marks.push({ from: start, to: start + m[0].length, deco: Decoration.mark({ class: 'cm-md-comment' }) });
    }
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  let lastTo = -1;
  for (const m of marks) {
    const isLine = m.from === m.to;
    if (!isLine && m.from < lastTo) continue;
    builder.add(m.from, m.to, m.deco);
    if (!isLine) lastTo = m.to;
  }
  return builder.finish();
}

export function wikilinks(opts: WikilinkOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, opts);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.transactions.some((t) => t.reconfigured || t.effects.some((e) => e.is(refreshLinks)))
        ) {
          this.decorations = build(u.view, opts);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = (e.target as HTMLElement).closest('.cm-wikilink') as HTMLElement | null;
      if (!el || e.button !== 0) return false;
      const target = el.dataset.target;
      if (!target) return false;
      const pos = view.posAtDOM(el);
      if (e.metaKey || opts.plainClickFollows(view, pos)) {
        e.preventDefault();
        opts.onFollow(target, e.metaKey && e.altKey);
        return true;
      }
      return false;
    },
  });

  return [plugin, clicks];
}

import { syntaxTree } from '@codemirror/language';
import katex from 'katex';
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { renderBlockHtml } from './markdown';
import { inCode, linkTarget, WIKILINK_RE } from './wikilinks';

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-lp-bullet';
    s.textContent = '•';
    return s;
  }
}

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-lp-task';
    input.checked = this.checked;
    input.setAttribute('aria-label', this.checked ? 'Mark task as not done' : 'Mark task as done');
    input.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' } });
    });
    return input;
  }
  ignoreEvent() {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src;
  }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-lp-embed';
    img.src = this.src;
    img.alt = '';
    return img;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-lp-math';
    span.innerHTML = katex.renderToString(this.tex, { displayMode: this.display, throwOnError: false });
    return span;
  }
}

export interface LivePreviewOptions {
  assetFor: (target: string) => string | null;
}

function activeLines(state: EditorState, focused: boolean) {
  const set = new Set<number>();
  if (!focused) return set;
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}

export function frontmatterEnd(state: EditorState) {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text !== '---') return 0;
  for (let i = 2; i <= Math.min(doc.lines, 200); i++) {
    const text = doc.line(i).text;
    if (text === '---' || text === '...') return doc.line(i).to;
  }
  return 0;
}

interface Pending {
  from: number;
  to: number;
  deco: Decoration;
}

function build(view: EditorView, opts: LivePreviewOptions): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(state, view.hasFocus);
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const fmEnd = frontmatterEnd(state);
  const out: Pending[] = [];
  const hide = (from: number, to: number) => {
    if (to > from) out.push({ from, to, deco: Decoration.replace({}) });
  };
  const lineClass = (pos: number, cls: string) => {
    const line = doc.lineAt(pos);
    out.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }) });
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.to <= fmEnd) return false;
        const name = node.name;
        if (name === 'FencedCode') {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let i = first; i <= last; i++) lineClass(doc.line(i).from, 'cm-codeblock');
          return false;
        }
        if (name === 'Link') {
          const before = state.sliceDoc(Math.max(0, node.from - 1), node.from + 2);
          const head = state.sliceDoc(node.from, node.from + 2);
          if (before.startsWith('[') || before.endsWith('[[') || head === '[[' || head === '[!' || head === '[^') return false;
          return;
        }
        if (name === 'Blockquote') {
          const first = doc.lineAt(node.from);
          const callout = /^>\s?\[!([\w-]+)\][+-]?\s?/.exec(first.text);
          const last = doc.lineAt(node.to).number;
          for (let i = first.number; i <= last; i++) {
            const line = doc.line(i);
            if (callout) {
              out.push({
                from: line.from,
                to: line.from,
                deco: Decoration.line({
                  class: i === first.number ? 'cm-lp-callout cm-lp-callout-title' : 'cm-lp-callout',
                  attributes: { 'data-callout': callout[1].toLowerCase() },
                }),
              });
            } else {
              lineClass(line.from, 'cm-lp-quote');
            }
          }
          if (callout && !isActive(first.from)) hide(first.from + first.text.indexOf('[!'), first.from + callout[0].length);
          return;
        }
        if (isActive(node.from)) return;
        switch (name) {
          case 'HeaderMark': {
            const line = doc.lineAt(node.from);
            const end = node.to < line.to && state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            hide(node.from, end);
            break;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            hide(node.from, node.to);
            break;
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode') hide(node.from, node.to);
            break;
          case 'LinkMark':
          case 'URL':
            if (node.node.parent?.name === 'Link') hide(node.from, node.to);
            break;
          case 'QuoteMark': {
            const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
            hide(node.from, end);
            break;
          }
          case 'ListMark': {
            const mark = state.sliceDoc(node.from, node.to);
            const hasTask = state.sliceDoc(node.to, node.to + 4).match(/^ \[[ xX]\]/);
            if ((mark === '-' || mark === '*' || mark === '+') && !hasTask) {
              out.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new BulletWidget() }) });
            } else if (hasTask) {
              hide(node.from, node.to + 1);
            }
            break;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            out.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new TaskWidget(checked, node.from) }) });
            if (checked) {
              const line = doc.lineAt(node.from);
              if (node.to + 1 < line.to) out.push({ from: node.to + 1, to: line.to, deco: Decoration.mark({ class: 'cm-lp-task-done' }) });
            }
            break;
          }
          case 'HorizontalRule':
            lineClass(node.from, 'cm-lp-hr');
            break;
          case 'Image': {
            const url = node.node.getChild('URL');
            if (!url) break;
            const raw = state.sliceDoc(url.from, url.to).replace(/^<|>$/g, '');
            if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) break;
            let target = raw;
            try {
              target = decodeURIComponent(raw);
            } catch {
              target = raw;
            }
            const src = opts.assetFor(target.split('#')[0]);
            if (src) {
              out.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new ImageWidget(src) }) });
              return false;
            }
            break;
          }
          case 'Blockquote':
            break;
        }
      },
    });

    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(WIKILINK_RE)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      if (start < fmEnd || isActive(start) || inCode(state, start)) continue;
      const embed = !!m[1];
      const inner = m[2];
      const target = linkTarget(inner);
      if (embed && IMAGE_RE.test(target)) {
        const src = opts.assetFor(target);
        if (src) {
          out.push({ from: start, to: end, deco: Decoration.replace({ widget: new ImageWidget(src) }) });
          continue;
        }
      }
      const open = embed ? 3 : 2;
      hide(start, start + open);
      const pipe = inner.indexOf('|');
      if (pipe >= 0) hide(start + open, start + open + pipe + 1);
      hide(end - 2, end);
    }

    for (const m of text.matchAll(/==([^=\n]+)==/g)) {
      const start = from + m.index!;
      if (start < fmEnd || isActive(start) || inCode(state, start)) continue;
      hide(start, start + 2);
      hide(start + m[0].length - 2, start + m[0].length);
    }

    for (const m of text.matchAll(/(\$\$?)([^$\n]+?)\1/g)) {
      const start = from + m.index!;
      const end = start + m[0].length;
      const tex = m[2];
      const display = m[1] === '$$';
      const prev = state.sliceDoc(start - 1, start);
      const next = state.sliceDoc(end, end + 1);
      if (!display && (/^\s|\s$/.test(tex) || /\d/.test(next) || prev === '\\' || prev === '$')) continue;
      if (start < fmEnd || isActive(start) || inCode(state, start)) continue;
      out.push({ from: start, to: end, deco: Decoration.replace({ widget: new MathWidget(tex, display) }) });
    }
  }

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  const seenLines = new Set<string>();
  for (const p of out) {
    if (p.from === p.to) {
      const key = `${p.from}:${(p.deco.spec as { class?: string }).class}`;
      if (seenLines.has(key)) continue;
      seenLines.add(key);
      builder.add(p.from, p.to, p.deco);
      continue;
    }
    if (p.from < lastTo) continue;
    builder.add(p.from, p.to, p.deco);
    lastTo = p.to;
  }
  return builder.finish();
}

class BlockWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly pos: number,
    readonly cls: string,
  ) {
    super();
  }
  eq(other: BlockWidget) {
    return other.html === this.html && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const div = document.createElement('div');
    div.className = this.cls;
    div.innerHTML = this.html;
    div.title = 'Click to edit';
    div.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.pos } });
      view.focus();
    });
    return div;
  }
  ignoreEvent() {
    return true;
  }
}

/**
 * Multi-line blocks (display math, tables) render as widgets whenever the
 * cursor is outside them. Block widgets must come from a state field.
 */
function blockDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const touched = (from: number, to: number) => state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const fmEnd = frontmatterEnd(state);
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.from < fmEnd || line.text.trim() !== '$$' || inCode(state, line.from)) continue;
    let j = i + 1;
    while (j <= doc.lines && doc.line(j).text.trim() !== '$$') j++;
    if (j > doc.lines) break;
    const close = doc.line(j);
    if (!touched(line.from, close.to)) {
      const tex = state.sliceDoc(doc.line(i + 1).from, doc.line(j - 1).to);
      const html = katex.renderToString(tex, { displayMode: true, throwOnError: false });
      ranges.push({ from: line.from, to: close.to, deco: Decoration.replace({ widget: new BlockWidget(html, line.from + 3, 'cm-lp-mathblock'), block: true }) });
    }
    i = j;
  }
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return;
      const from = doc.lineAt(node.from).from;
      const to = doc.lineAt(node.to).to;
      if (from >= fmEnd && !touched(from, to)) {
        ranges.push({
          from,
          to,
          deco: Decoration.replace({ widget: new BlockWidget(renderBlockHtml(state.sliceDoc(from, to)), from, 'cm-lp-table'), block: true }),
        });
      }
      return false;
    },
  });
  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to)), true);
}

const blockPreview = StateField.define<DecorationSet>({
  create: (state) => blockDecorations(state),
  update: (value, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? blockDecorations(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});

export function livePreview(opts: LivePreviewOptions): Extension {
  return [blockPreview, inlinePreview(opts)];
}

function inlinePreview(opts: LivePreviewOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, opts);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || u.transactions.some((t) => t.reconfigured)) {
          this.decorations = build(u.view, opts);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Finds the URL of a rendered markdown link at a position, if any. */
export function markdownLinkAt(state: EditorState, pos: number): string | null {
  let node = syntaxTree(state).resolveInner(pos, 1) as ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null;
  while (node && node.name !== 'Link') node = node.parent;
  if (!node) return null;
  const url = node.getChild('URL');
  return url ? state.sliceDoc(url.from, url.to) : null;
}

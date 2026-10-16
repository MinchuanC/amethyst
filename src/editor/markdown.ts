import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { linkTarget } from './wikilinks';

export interface RenderContext {
  resolve: (target: string) => string | null;
  assetUrl: (path: string) => string;
  /** Already-rendered HTML for an embedded note, keyed by the embed's inner text. */
  embed?: (inner: string) => string | null;
}

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let ctx: RenderContext = { resolve: () => null, assetUrl: () => '' };

const md = new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: false });
md.use(footnote);

const renderTex = (tex: string, displayMode: boolean) => {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, output: 'htmlAndMathml' });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
};

md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.slice(start, start + 2) !== '$$') return false;
  const firstLine = state.src.slice(start + 2, max);
  if (silent) return true;
  let content = '';
  let line = startLine;
  if (firstLine.trim().endsWith('$$')) {
    content = firstLine.trim().slice(0, -2);
  } else {
    content = firstLine;
    for (line = startLine + 1; line < endLine; line++) {
      const s = state.bMarks[line] + state.tShift[line];
      const text = state.src.slice(s, state.eMarks[line]);
      if (text.trim().endsWith('$$')) {
        content += `\n${text.trim().slice(0, -2)}`;
        break;
      }
      content += `\n${text}`;
    }
  }
  state.line = line + 1;
  const token = state.push('math_block', 'math', 0);
  token.content = content.trim();
  token.map = [startLine, state.line];
  return true;
});
md.renderer.rules.math_block = (tokens, idx) => `<div class="math-block">${renderTex(tokens[idx].content, true)}</div>`;

md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
  const src = state.src;
  const pos = state.pos;
  if (src[pos] !== '$' || src[pos + 1] === '$' || /\s/.test(src[pos + 1] ?? ' ')) return false;
  let end = pos + 1;
  while ((end = src.indexOf('$', end)) !== -1) {
    if (src[end - 1] !== '\\') break;
    end++;
  }
  if (end === -1 || /\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? '')) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = src.slice(pos + 1, end);
  }
  state.pos = end + 1;
  return true;
});
md.renderer.rules.math_inline = (tokens, idx) => renderTex(tokens[idx].content, false);

md.inline.ruler.before('emphasis', 'highlight', (state, silent) => {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x3d || src.charCodeAt(pos + 1) !== 0x3d) return false;
  const end = src.indexOf('==', pos + 2);
  if (end < 0 || end === pos + 2) return false;
  if (!silent) {
    state.push('mark_open', 'mark', 1);
    const inner = state.md.parseInline(src.slice(pos + 2, end), state.env)[0]?.children ?? [];
    for (const child of inner) state.tokens.push(child);
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
});

/** Obsidian callouts: a blockquote whose first line is `[!type] Title`. */
md.core.ruler.before('inline', 'callouts', (state) => {
  const tokens = state.tokens;
  const stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'blockquote_open') {
      stack.push(i);
      const inline = tokens[i + 2];
      if (tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
      const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)(?:\n|$)/.exec(inline.content);
      if (!m) continue;
      const type = m[1].toLowerCase();
      t.meta = { callout: type, title: m[3].trim() || type.charAt(0).toUpperCase() + type.slice(1) };
      inline.content = inline.content.slice(m[0].length);
    } else if (t.type === 'blockquote_close') {
      const open = stack.pop();
      if (open != null && tokens[open].meta?.callout) t.meta = { callout: tokens[open].meta.callout };
    }
  }
});

const defaultQuoteOpen = md.renderer.rules.blockquote_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
const defaultQuoteClose = md.renderer.rules.blockquote_close ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
  const meta = tokens[idx].meta as { callout?: string; title?: string } | null;
  if (!meta?.callout) return defaultQuoteOpen(tokens, idx, options, env, self);
  return `<div class="callout" data-callout="${escapeHtml(meta.callout)}"><p class="callout-title">${escapeHtml(meta.title ?? '')}</p><div class="callout-body">`;
};
md.renderer.rules.blockquote_close = (tokens, idx, options, env, self) => {
  const meta = tokens[idx].meta as { callout?: string } | null;
  return meta?.callout ? '</div></div>' : defaultQuoteClose(tokens, idx, options, env, self);
};

md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  let pos = state.pos;
  let embed = false;
  if (state.src.charCodeAt(pos) === 0x21 && state.src.startsWith('[[', pos + 1)) {
    embed = true;
    pos++;
  }
  if (!state.src.startsWith('[[', pos)) return false;
  const end = state.src.indexOf(']]', pos + 2);
  if (end < 0) return false;
  const inner = state.src.slice(pos + 2, end);
  if (!inner || inner.includes('\n') || inner.includes('[')) return false;
  if (!silent) {
    const token = state.push('wikilink', '', 0);
    token.meta = { inner, embed };
  }
  state.pos = end + 2;
  return true;
});

md.renderer.rules.wikilink = (tokens, idx) => {
  const { inner, embed } = tokens[idx].meta as { inner: string; embed: boolean };
  const target = linkTarget(inner);
  const pipe = inner.indexOf('|');
  const hash = inner.indexOf('#');
  const display = pipe >= 0 ? inner.slice(pipe + 1) : hash >= 0 && !target ? inner.slice(hash + 1) : inner.replace(/#/, ' › ');
  const resolved = target ? ctx.resolve(target) : null;
  if (embed && resolved && IMAGE_RE.test(resolved)) {
    return `<img class="rv-embed" src="${escapeHtml(ctx.assetUrl(resolved))}" alt="${escapeHtml(display)}">`;
  }
  const embedded = embed && resolved ? ctx.embed?.(inner) : null;
  if (embedded != null) {
    const title = resolved!.split('/').pop()!.replace(/\.md$/i, '');
    return `<span class="embed-note"><a class="wikilink embed-title" data-target="${escapeHtml(target)}">${escapeHtml(title)}${hash >= 0 ? ` › ${escapeHtml(inner.slice(hash + 1).split('|')[0])}` : ''}</a><span class="embed-body">${embedded}</span></span>`;
  }
  const cls = ['wikilink', resolved ? '' : 'unresolved', embed ? 'transclusion' : ''].filter(Boolean).join(' ');
  return `<a class="${cls}" data-target="${escapeHtml(target)}">${embed ? '↳ ' : ''}${escapeHtml(display.trim())}</a>`;
};

md.inline.ruler.before('emphasis', 'tag', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x23) return false;
  const prev = state.pos === 0 ? ' ' : state.src[state.pos - 1];
  if (!/\s/.test(prev)) return false;
  const m = /^#([\p{L}\p{N}\p{M}_/-]+)/u.exec(state.src.slice(state.pos));
  if (!m || /^[\d/_-]+$/.test(m[1])) return false;
  if (!silent) {
    const token = state.push('tag', '', 0);
    token.content = m[1].replace(/\/+$/, '');
  }
  state.pos += m[0].length;
  return true;
});

md.renderer.rules.tag = (tokens, idx) => {
  const tag = tokens[idx].content;
  return `<span class="tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`;
};

const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = String(tokens[idx].attrGet('href') ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) tokens[idx].attrSet('data-external', 'true');
  else tokens[idx].attrSet('data-md-link', 'true');
  return defaultLink(tokens, idx, options, env, self);
};

const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = String(tokens[idx].attrGet('src') ?? '');
  if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    const resolved = ctx.resolve(decodeURIComponent(src));
    if (resolved) tokens[idx].attrSet('src', ctx.assetUrl(resolved));
  }
  return defaultImage(tokens, idx, options, env, self);
};

export interface Frontmatter {
  tags: string[];
  aliases: string[];
  fields: [string, string][];
}

export function splitFrontmatter(text: string): { fm: Frontmatter | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: null, body: text };
  const fm: Frontmatter = { tags: [], aliases: [], fields: [] };
  let listKey: string | null = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      const v = item[1].replace(/^["']|["']$/g, '');
      if (listKey === 'tags') fm.tags.push(v.replace(/^#/, ''));
      else if (listKey === 'aliases') fm.aliases.push(v);
      else fm.fields.push([listKey, v]);
      continue;
    }
    const kv = /^([\w -]+):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    listKey = value === '' ? key : null;
    const list = value.startsWith('[') ? value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : null;
    if (key === 'tags' || key === 'tag') fm.tags.push(...(list ?? value.split(/[\s,]+/).filter(Boolean)).map((t) => t.replace(/^#/, '')));
    else if (key === 'aliases' || key === 'alias') fm.aliases.push(...(list ?? value.split(',').map((s) => s.trim()).filter(Boolean)));
    else if (value) fm.fields.push([key, list ? list.join(', ') : value.replace(/^["']|["']$/g, '')]);
  }
  return { fm, body: text.slice(m[0].length) };
}

export function collectTargets(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(/!?\[\[([^[\]\n]+?)\]\]/g)) {
    const t = linkTarget(m[1]);
    if (t) out.add(t);
  }
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(m[1])) continue;
    try {
      out.add(decodeURIComponent(m[1]));
    } catch {
      out.add(m[1]);
    }
  }
  return [...out];
}

/** Obsidian `%% comments %%` are for the writer only and never render. */
export function stripComments(body: string) {
  return body.replace(/%%[\s\S]*?%%/g, '');
}

/** Renders a self-contained block (a table) for the editor's live preview. */
export function renderBlockHtml(src: string) {
  if (!DOMPurify.isSupported) return `<pre>${escapeHtml(src)}</pre>`;
  return DOMPurify.sanitize(md.render(src));
}

export function renderMarkdown(body: string, context: RenderContext) {
  ctx = context;
  let html = md.render(stripComments(body));
  html = html.replace(/<li>(\s*<p>)?\[( |x|X)\]\s/g, (_m, p = '', mark: string) => {
    const done = mark.toLowerCase() === 'x';
    return `<li class="task${done ? ' done' : ''}">${p}<span class="task-box${done ? ' checked' : ''}" aria-hidden="true"></span>`;
  });
  if (!DOMPurify.isSupported) return `<pre>${escapeHtml(body)}</pre>`;
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|asset|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ADD_ATTR: ['data-target', 'data-tag', 'data-external', 'data-md-link', 'data-callout'],
  });
}

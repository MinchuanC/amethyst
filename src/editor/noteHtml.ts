import { api } from '../api';
import { useVault } from '../state/vault';
import { collectTargets, renderMarkdown, splitFrontmatter, type Frontmatter } from './markdown';
import { linkTarget } from './wikilinks';

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
const EMBED_RE = /!\[\[([^[\]\n]+?)\]\]/g;

/** Resolves a link target from the cached link targets, without a round trip. */
function resolveLocally(target: string) {
  const t = target.toLowerCase().replace(/\.md$/, '');
  for (const lt of useVault.getState().linkTargets) {
    const p = lt.path.toLowerCase();
    if (p === t || p.replace(/\.md$/, '') === t || lt.title.toLowerCase() === t || lt.aliases.some((a) => a.toLowerCase() === t)) return lt.path;
    if (!t.includes('/') && p.split('/').pop() === t) return lt.path;
  }
  return null;
}

/** The part of a note under one heading, through to the next heading of the same or higher level. */
export function sectionOf(body: string, heading: string) {
  const lines = body.split('\n');
  const want = heading.trim().toLowerCase();
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === want);
  if (start < 0) return body;
  const level = /^#+/.exec(lines[start])![0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Drops a leading heading that repeats the title already shown above the note. */
export function withoutDuplicateTitle(html: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`^\\s*<h1[^>]*>\\s*${escaped}\\s*</h1>`), '');
}

export interface RenderedNote {
  html: string;
  frontmatter: Frontmatter | null;
}

/**
 * Renders a note for reading: resolves every link and image, and inlines
 * embedded notes (`![[Note]]`, `![[Note#Heading]]`) one level deep.
 */
export async function renderNote(path: string, text: string, depth = 0): Promise<RenderedNote> {
  const { fm, body } = splitFrontmatter(text);
  const targets = collectTargets(body);
  const resolved = new Map(await Promise.all(targets.map(async (t) => [t, await api.resolveLink(t, path)] as const)));
  const embeds = new Map<string, string>();
  if (depth === 0) {
    for (const m of body.matchAll(EMBED_RE)) {
      const inner = m[1];
      const target = resolved.get(linkTarget(inner));
      if (!target || target === path || IMAGE_RE.test(target) || !/\.md$/i.test(target) || embeds.has(inner)) continue;
      try {
        const raw = splitFrontmatter(await api.readNote(target)).body;
        const hash = inner.split('|')[0].indexOf('#');
        const part = hash >= 0 ? sectionOf(raw, inner.split('|')[0].slice(hash + 1)) : raw;
        embeds.set(inner, renderMarkdown(part, { resolve: resolveLocally, assetUrl: api.assetUrl }));
      } catch {
        /* missing or unreadable: falls back to a link */
      }
    }
  }
  const html = renderMarkdown(body, {
    resolve: (t) => resolved.get(t) ?? resolveLocally(t),
    assetUrl: api.assetUrl,
    embed: (inner) => embeds.get(inner) ?? null,
  });
  return { html, frontmatter: fm };
}

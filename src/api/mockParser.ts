/**
 * A small TypeScript stand-in for the Rust parser, used only by the browser
 * mock backend. The Rust parser is the source of truth in the app.
 */
export interface LiteLink {
  target: string;
  embed: boolean;
  markdown: boolean;
  start: number;
  end: number;
  line: number;
}

export interface LiteParsed {
  links: LiteLink[];
  tags: string[];
  aliases: string[];
  created: number | null;
  headings: { level: number; text: string }[];
  bodyStart: number;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseNote(text: string): LiteParsed {
  const out: LiteParsed = { links: [], tags: [], aliases: [], created: null, headings: [], bodyStart: 0 };
  const fm = FRONTMATTER.exec(text);
  if (fm) {
    out.bodyStart = fm[0].length;
    const yaml = parseYamlLite(fm[1]);
    for (const t of listOf(yaml.tags ?? yaml.tag, true)) pushTag(out.tags, t.replace(/^#/, ''));
    out.aliases = listOf(yaml.aliases ?? yaml.alias, false);
    const created = yaml.created ?? yaml.date ?? yaml.created_at;
    if (typeof created === 'string') {
      const ms = Date.parse(created.slice(0, 10));
      if (!Number.isNaN(ms)) out.created = ms;
    }
  }
  const masked = maskCode(text, out.bodyStart);
  const lineAt = (pos: number) => {
    let n = 0;
    for (let i = 0; i < pos; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  };
  const taken: [number, number][] = [];
  for (const m of masked.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
    const start = m.index!;
    if (start < out.bodyStart) continue;
    taken.push([start, start + m[0].length]);
    const target = m[2].split('|')[0].replace(/\\$/, '').split('#')[0].trim();
    if (target) out.links.push({ target, embed: m[1] === '!', markdown: false, start, end: start + m[0].length, line: lineAt(start) });
  }
  for (const m of masked.matchAll(/(!?)\[([^[\]\n]*)\]\(([^()\n]+)\)/g)) {
    const start = m.index!;
    if (start < out.bodyStart || taken.some(([s, e]) => start < e && start + m[0].length > s)) continue;
    taken.push([start, start + m[0].length]);
    let url = m[3].trim().replace(/\s+["'].*$/, '');
    if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1);
    if (!url || url.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(url)) continue;
    const target = safeDecode(url.split('#')[0]).trim();
    if (target) out.links.push({ target, embed: m[1] === '!', markdown: true, start, end: start + m[0].length, line: lineAt(start) });
  }
  out.links.sort((a, b) => a.start - b.start);
  for (const m of masked.matchAll(/(^|\s)#([\p{L}\p{N}\p{M}_/-]+)/gmu)) {
    const hash = m.index! + m[1].length;
    if (hash < out.bodyStart || taken.some(([s, e]) => hash >= s && hash < e)) continue;
    const tag = m[2].replace(/\/+$/, '');
    if (tag && !/^[\d/_-]+$/.test(tag)) pushTag(out.tags, tag);
  }
  for (const m of masked.slice(out.bodyStart).matchAll(/^(#{1,6})\s+(.+?)\s*#*$/gm)) {
    out.headings.push({ level: m[1].length, text: m[2] });
  }
  return out;
}

function maskCode(text: string, from: number) {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  const head = text.slice(0, from);
  const body = text
    .slice(from)
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|$(?![\s\S]))/gm, blank)
    .replace(/`[^`\n]+`/g, blank)
    .replace(/\$[^$\n]+\$/g, blank);
  return head + body;
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function pushTag(tags: string[], tag: string) {
  if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
}

type YamlValue = string | string[];

function parseYamlLite(src: string): Record<string, YamlValue> {
  const out: Record<string, YamlValue> = {};
  let listKey: string | null = null;
  for (const raw of src.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w -]*):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      out[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value.slice(1, -1).split(',').map((v) => unquote(v.trim())).filter(Boolean);
      listKey = null;
    } else {
      out[key] = unquote(value);
      listKey = null;
    }
  }
  return out;
}

function unquote(s: string) {
  return s.replace(/^["']|["']$/g, '');
}

function listOf(v: YamlValue | undefined, splitSpaces: boolean): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v.split(splitSpaces ? /[,\s]+/ : /,/).map((s) => s.trim()).filter(Boolean);
}

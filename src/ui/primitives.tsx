import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function IconButton({
  label,
  children,
  active,
  className = '',
  ...rest
}: { label: string; children: ReactNode; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Wraps matched characters (by index) in <mark>. */
export function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const parts: ReactNode[] = [];
  let run = '';
  let inMatch = false;
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== inMatch && run) {
      parts.push(inMatch ? <mark key={i}>{run}</mark> : run);
      run = '';
    }
    inMatch = hit;
    run += text[i];
  }
  if (run) parts.push(inMatch ? <mark key="end">{run}</mark> : run);
  return <>{parts}</>;
}

/** Highlights whole-word query terms in a snippet. */
export function TermHighlight({ text, terms }: { text: string; terms: string[] }) {
  const clean = terms.map((t) => t.trim()).filter(Boolean);
  if (!clean.length) return <>{text}</>;
  const re = new RegExp(`(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

export const stripMd = (p: string) => p.replace(/\.md$/i, '');
export const titleOf = (p: string) => stripMd(p.split('/').pop() ?? p);
export const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatDate(ms: number) {
  return ms ? dateFormat.format(new Date(ms)) : 'unknown';
}

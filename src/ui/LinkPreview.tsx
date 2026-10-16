import { ArrowUpRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { followLink, openNode } from '../actions';
import { api } from '../api';
import { renderNote } from '../editor/noteHtml';
import { usePreview } from '../state/preview';
import { folderOf, titleOf } from './primitives';

const WIDTH = 460;
const MAX_HEIGHT = 380;
const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

/** Obsidian-style page preview: hover a link to read the note without leaving this one. */
export function LinkPreview() {
  const path = usePreview((s) => s.path);
  const anchor = usePreview((s) => s.anchor);
  const [html, setHtml] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHtml(null);
    if (!path || IMAGE_RE.test(path)) return;
    let cancelled = false;
    api
      .readNote(path)
      .then((text) => renderNote(path, text, 1))
      .then((r) => !cancelled && setHtml(r.html))
      .catch(() => !cancelled && setHtml('<p>This note couldn’t be read.</p>'));
    return () => {
      cancelled = true;
    };
  }, [path]);

  useLayoutEffect(() => {
    if (!anchor) return setPos(null);
    const h = Math.min(MAX_HEIGHT, ref.current?.offsetHeight ?? MAX_HEIGHT);
    const below = anchor.bottom + 8 + h < window.innerHeight - 12;
    const top = below ? anchor.bottom + 8 : Math.max(12, anchor.top - 8 - h);
    const left = Math.min(Math.max(12, anchor.left), window.innerWidth - WIDTH - 12);
    setPos({ left, top });
  }, [anchor, html]);

  useEffect(() => {
    if (!path) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && usePreview.getState().hide();
    const onScroll = () => usePreview.getState().hide();
    window.addEventListener('keydown', close);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('wheel', onScroll);
    };
  }, [path]);

  if (!path || !anchor) return null;
  const preview = usePreview.getState();

  const onClick = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a.wikilink') as HTMLElement | null;
    if (link?.dataset.target) {
      e.preventDefault();
      preview.hide();
      followLink(link.dataset.target, path, e.metaKey);
    }
  };

  return (
    <div
      ref={ref}
      className="link-preview"
      role="dialog"
      aria-label={`Preview of ${titleOf(path)}`}
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 8, visibility: pos ? 'visible' : 'hidden' }}
      onMouseEnter={preview.keep}
      onMouseLeave={preview.scheduleHide}
    >
      <header className="link-preview-head">
        <div>
          <p className="link-preview-title">{titleOf(path)}</p>
          <p className="link-preview-folder">{folderOf(path) || 'Vault root'}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={`Open ${titleOf(path)}`}
          onClick={() => {
            preview.hide();
            openNode(path);
          }}
        >
          <ArrowUpRight size={15} />
        </button>
      </header>
      <div className="link-preview-body reading-body" onClick={onClick}>
        {IMAGE_RE.test(path) ? (
          <img src={api.assetUrl(path)} alt="" />
        ) : html === null ? (
          <p className="link-preview-loading">Loading…</p>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}

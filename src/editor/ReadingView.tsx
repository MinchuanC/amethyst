import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { followLink, openExternal, reportError } from '../actions';
import { api } from '../api';
import { useEditorStats } from '../state/editorStats';
import { rectOf, usePreview } from '../state/preview';
import { useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import type { Frontmatter } from './markdown';
import { renderNote, withoutDuplicateTitle } from './noteHtml';

export function ReadingView({ path }: { path: string }) {
  const graphVersion = useVault((s) => s.graphVersion);
  const [html, setHtml] = useState('');
  const [fm, setFm] = useState<Frontmatter | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await api.readNote(path);
        if (cancelled) return;
        useEditorStats.getState().set(path, text);
        const rendered = await renderNote(path, text);
        if (cancelled) return;
        setFm(rendered.frontmatter);
        const title = path.split('/').pop()!.replace(/\.md$/i, '');
        setHtml(withoutDuplicateTitle(rendered.html, title));
      } catch (e) {
        if (!cancelled) reportError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, graphVersion]);

  const onOver = async (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a.wikilink:not(.unresolved)') as HTMLElement | null;
    if (!link?.dataset.target || link.closest('.link-preview')) return;
    const resolved = await api.resolveLink(link.dataset.target, path);
    if (resolved && resolved !== path) usePreview.getState().show(resolved, rectOf(link));
  };
  const onOut = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a.wikilink')) usePreview.getState().scheduleHide();
  };

  const onClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const wiki = el.closest('a.wikilink') as HTMLElement | null;
    if (wiki?.dataset.target) {
      e.preventDefault();
      usePreview.getState().hide();
      followLink(wiki.dataset.target, path, e.metaKey);
      return;
    }
    const tag = el.closest('.tag') as HTMLElement | null;
    if (tag?.dataset.tag) {
      const ws = useWorkspace.getState();
      ws.setSearchQuery(`#${tag.dataset.tag}`);
      ws.setLeftTab('search');
      return;
    }
    const a = el.closest('a[href]') as HTMLAnchorElement | null;
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        (e.currentTarget as HTMLElement).querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (a.dataset.external) openExternal(href);
      else if (href) {
        let target = href.split('#')[0];
        try {
          target = decodeURIComponent(target);
        } catch {
          /* keep the raw href */
        }
        followLink(target, path, e.metaKey);
      }
    }
  };

  return (
    <article className="reading" ref={ref} onClick={onClick} onMouseOver={onOver} onMouseOut={onOut}>
      {fm && (fm.tags.length > 0 || fm.aliases.length > 0 || visibleFields(fm).length > 0) && (
        <dl className="properties">
          {fm.aliases.length > 0 && (
            <div>
              <dt>Aliases</dt>
              <dd>{fm.aliases.join(', ')}</dd>
            </div>
          )}
          {fm.tags.length > 0 && (
            <div>
              <dt>Tags</dt>
              <dd>
                {fm.tags.map((t) => (
                  <span key={t} className="tag" data-tag={t}>
                    #{t}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {visibleFields(fm).map(([k, v]) => (
            <div key={k}>
              <dt>{k.charAt(0).toUpperCase() + k.slice(1)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="reading-body" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}

/** The meta line already shows when the note was created. */
function visibleFields(fm: Frontmatter) {
  return fm.fields.filter(([key]) => !/^(created|created_at|date)$/i.test(key));
}

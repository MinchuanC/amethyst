import { ChevronRight, CornerDownRight, Link2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { followLink, openNode, reportError } from '../actions';
import { api, type Mention, type NoteLinks, type SimilarNote } from '../api';
import { useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';

export function LinksPanel() {
  const active = useWorkspace((s) => s.active);
  const graphVersion = useVault((s) => s.graphVersion);
  const structureVersion = useVault((s) => s.structureVersion);
  const [links, setLinks] = useState<NoteLinks | null>(null);
  const [similar, setSimilar] = useState<SimilarNote[] | null>(null);
  const [mentions, setMentions] = useState<Mention[] | null>(null);

  useEffect(() => {
    if (!active) {
      setLinks(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.noteLinks(active).then((l) => !cancelled && setLinks(l)).catch(() => {});
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, graphVersion]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.similarNotes(active, 6).then((s) => !cancelled && setSimilar(s)).catch(() => setSimilar([]));
      api.unlinkedMentions(active).then((m) => !cancelled && setMentions(m)).catch(() => setMentions([]));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, structureVersion]);

  if (!active) {
    return (
      <aside className="panel links-panel" aria-label="Links">
        <p className="pane-empty">Open a note to see what links to it.</p>
      </aside>
    );
  }

  const open = useWorkspace.getState().openNote;
  const outline = links?.headings ?? [];

  return (
    <aside className="panel links-panel" aria-label="Links">
      <Section title="Backlinks" count={links?.backlinks.length}>
        {links?.backlinks.length === 0 && <p className="section-empty">No notes link here yet.</p>}
        {links?.backlinks.map((b) => (
          <div key={b.source} className="backlink">
            <button type="button" className="link-row" onClick={(e) => open(b.source, { newTab: e.metaKey })}>
              {b.title}
            </button>
            {b.snippets.map((s) => (
              <button type="button" key={s.line} className="backlink-snippet" onClick={() => open(b.source, { line: s.line })}>
                <SnippetText text={s.text} />
              </button>
            ))}
          </div>
        ))}
      </Section>

      <Section title="Outgoing" count={links?.outgoing.length}>
        {links?.outgoing.length === 0 && <p className="section-empty">This note doesn’t link anywhere.</p>}
        {links?.outgoing.map((o) => (
          <button
            type="button"
            key={o.target}
            className={`link-row ${o.resolved ? '' : 'is-unresolved'}`}
            title={o.resolved ? o.target : 'Not created yet. Click to create it.'}
            onClick={(e) => (o.resolved ? openNode(o.target, e.metaKey) : followLink(o.title, active))}
          >
            {o.kind === 'embed' ? <CornerDownRight size={12} aria-hidden /> : <Link2 size={12} aria-hidden />}
            {o.title}
          </button>
        ))}
      </Section>

      <Section title="Unlinked mentions" count={mentions?.length} defaultOpen={false}>
        {mentions?.length === 0 && <p className="section-empty">No plain-text mentions of this title.</p>}
        {mentions?.map((m) => (
          <div key={`${m.source}:${m.offset}`} className="mention">
            <button type="button" className="link-row" onClick={() => open(m.source, { line: m.line })}>
              {m.title}
            </button>
            <p className="mention-text">{m.text}</p>
            <button
              type="button"
              className="mention-link"
              onClick={() =>
                api
                  .linkMention(m.source, m.offset, m.length, active)
                  .then(() => useWorkspace.getState().toast(`Linked from “${m.title}”.`))
                  .catch(reportError)
              }
            >
              Turn into link
            </button>
          </div>
        ))}
      </Section>

      <Section title="Similar notes" count={similar?.length} hint="By shared keywords">
        {similar?.length === 0 && <p className="section-empty">No notes share enough keywords.</p>}
        {similar?.map((s) => (
          <button type="button" key={s.path} className="link-row similar-row" onClick={(e) => open(s.path, { newTab: e.metaKey })}>
            <span className="similar-title">{s.title}</span>
            <span className="similar-bar" aria-label={`Similarity ${Math.round(s.score * 100)}%`}>
              <i style={{ width: `${Math.min(100, s.score * 160)}%` }} />
            </span>
          </button>
        ))}
      </Section>

      {outline.length > 0 && (
        <Section title="Outline" count={outline.length} defaultOpen={false}>
          {outline.map((h, i) => (
            <button
              type="button"
              key={i}
              className="outline-row"
              style={{ paddingLeft: 10 + (h.level - 1) * 12 }}
              onClick={async () => {
                const text = await api.readNote(active);
                const lines = text.split('\n');
                const line = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim() === h.text);
                if (line >= 0) open(active, { line });
              }}
            >
              {h.text}
            </button>
          ))}
        </Section>
      )}
    </aside>
  );
}

function Section({
  title,
  count,
  hint,
  defaultOpen = true,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="links-section">
      <button type="button" className="section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={`tree-chevron ${open ? 'is-open' : ''}`} aria-hidden />
        <span className="section-title">{title}</span>
        {hint && <span className="section-hint">{hint}</span>}
        <span className="section-count">{count ?? ''}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function SnippetText({ text }: { text: string }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('[[') ? (
          <mark key={i}>{p.slice(2, -2).split('|').pop()}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

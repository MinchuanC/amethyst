import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SearchHit } from '../api';
import { bus } from '../bus';
import { graphModel, useVault } from '../state/vault';
import { useWorkspace } from '../state/workspace';
import { folderOf, TermHighlight } from './primitives';

export function SearchPane() {
  const query = useWorkspace((s) => s.searchQuery);
  const setQuery = useWorkspace((s) => s.setSearchQuery);
  const graphVersion = useVault((s) => s.graphVersion);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => bus.on('search:focus', () => inputRef.current?.select()), []);

  const tagQuery = /^#[^\s#]+$/.test(query.trim()) ? query.trim().slice(1).toLowerCase() : null;

  useEffect(() => {
    if (tagQuery || !query.trim()) {
      setHits([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      api
        .search(query)
        .then(setHits)
        .finally(() => setBusy(false));
    }, 140);
    return () => clearTimeout(t);
  }, [query, tagQuery, graphVersion]);

  const tagHits = useMemo(() => {
    if (!tagQuery) return [];
    return [...graphModel.nodes.values()]
      .filter((n) => n.kind === 'note' && n.tags.some((t) => t.toLowerCase() === tagQuery || t.toLowerCase().startsWith(`${tagQuery}/`)))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [tagQuery, graphVersion]);

  const terms = query.split(/\s+/).filter(Boolean);
  const open = useWorkspace.getState().openNote;

  return (
    <div className="search-pane">
      <label className="search-field">
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          placeholder="Words, or #tag"
          aria-label="Search the vault"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          autoFocus
        />
        {query && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        )}
      </label>
      <div className="search-results" aria-live="polite">
        {tagQuery && (
          <>
            <p className="search-count num">
              {tagHits.length} note{tagHits.length === 1 ? '' : 's'} tagged #{tagQuery}
            </p>
            {tagHits.map((n) => (
              <button type="button" key={n.id} className="search-hit" onClick={(e) => open(n.id, { newTab: e.metaKey })}>
                <span className="search-title">{n.title}</span>
                <span className="search-folder">{n.folder || 'Vault root'}</span>
              </button>
            ))}
          </>
        )}
        {!tagQuery && query.trim() && !busy && (
          <p className="search-count num">
            {hits.length === 0 ? 'No notes match' : `${hits.length} note${hits.length === 1 ? '' : 's'}`}
          </p>
        )}
        {!tagQuery &&
          hits.map((h) => (
            <div key={h.path} className="search-hit-group">
              <button type="button" className="search-hit" onClick={(e) => open(h.path, { newTab: e.metaKey, line: h.snippets[0]?.line })}>
                <span className="search-title">
                  <TermHighlight text={h.title} terms={terms} />
                </span>
                <span className="search-folder">{folderOf(h.path) || 'Vault root'}</span>
              </button>
              {h.snippets.map((s) => (
                <button type="button" key={s.line} className="search-snippet" onClick={() => open(h.path, { line: s.line })}>
                  <TermHighlight text={s.text} terms={terms} />
                </button>
              ))}
            </div>
          ))}
        {!query.trim() && <p className="pane-empty">Search every note. Start with # to list notes by tag.</p>}
      </div>
    </div>
  );
}

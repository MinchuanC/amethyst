import { useMemo, useState, type KeyboardEvent } from 'react';
import { graphModel, useVault } from '../../state/vault';
import { rank } from '../fuzzy';
import { Highlighted } from '../primitives';

export function NotePicker({ label, value, onChange }: { label: string; value: string | null; onChange: (id: string | null) => void }) {
  const version = useVault((s) => s.structureVersion);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const notes = useMemo(
    () => [...graphModel.nodes.values()].filter((n) => n.kind === 'note').map((n) => ({ id: n.id, title: n.title, folder: n.folder })),
    [version],
  );
  const selected = value ? graphModel.nodes.get(value)?.title ?? value : '';
  const open = query !== null;
  const results = open ? rank(notes, query, (n) => n.title, 7) : [];

  const choose = (id: string) => {
    onChange(id);
    setQuery(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && results[index]) {
      e.preventDefault();
      choose(results[index].item.id);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setQuery(null);
    }
  };

  return (
    <div className="note-picker">
      <label>
        <span className="picker-label">{label}</span>
        <input
          value={open ? query : selected}
          placeholder="Type a note title"
          onFocus={() => {
            setQuery('');
            setIndex(0);
          }}
          onBlur={() => setTimeout(() => setQuery(null), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded={open}
        />
      </label>
      {open && results.length > 0 && (
        <ul className="picker-list" role="listbox">
          {results.map((r, i) => (
            <li key={r.item.id} role="option" aria-selected={i === index}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r.item.id)}>
                <Highlighted text={r.item.title} indices={r.indices} />
                <small>{r.item.folder || 'Vault root'}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

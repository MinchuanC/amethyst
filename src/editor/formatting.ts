import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type { Command, KeyBinding } from '@codemirror/view';

/** Wraps or unwraps each selection in `marker` (e.g. ** for bold). */
export function toggleWrap(marker: string): Command {
  return (view) => {
    const { state } = view;
    const n = marker.length;
    const tr = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - n, range.from);
      const after = state.sliceDoc(range.to, range.to + n);
      const inner = state.sliceDoc(range.from, range.to);
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - n, to: range.from },
            { from: range.to, to: range.to + n },
          ],
          range: EditorSelection.range(range.from - n, range.to - n),
        };
      }
      if (inner.length >= n * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
        return {
          changes: [
            { from: range.from, to: range.from + n },
            { from: range.to - n, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - n * 2),
        };
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + n, range.to + n),
      };
    });
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

/** Turns the selection into [[selection]], or inserts [[]] with the cursor inside. */
export const insertWikilink: Command = (view) => {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[[${text}]]`;
    const cursor = text ? range.from + insert.length : range.from + 2;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(cursor) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

const TASK = /^(\s*)([-*+]) \[( |x|X)\] /;
const BULLET = /^(\s*)([-*+]) /;

/** Cycles each selected line: plain → task → done task → task. */
export const toggleTask: Command = (view) => {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const task = TASK.exec(line.text);
        const bullet = BULLET.exec(line.text);
        if (task) {
          const at = line.from + task[1].length + 3;
          changes.push({ from: at, to: at + 1, insert: task[3] === ' ' ? 'x' : ' ' });
        } else if (bullet) {
          const at = line.from + bullet[0].length;
          changes.push({ from: at, insert: '[ ] ' });
        } else {
          const indent = /^\s*/.exec(line.text)![0].length;
          changes.push({ from: line.from + indent, insert: '- [ ] ' });
        }
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes, userEvent: 'input.format' });
  return true;
};

export const formattingKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: toggleWrap('**') },
  { key: 'Mod-i', run: toggleWrap('*') },
  { key: 'Mod-Shift-x', run: toggleWrap('~~') },
  { key: 'Mod-Shift-c', run: toggleWrap('`') },
  { key: 'Mod-Shift-h', run: toggleWrap('==') },
  { key: 'Mod-Shift-k', run: insertWikilink },
  { key: 'Mod-l', run: toggleTask },
];

import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { countWords } from '../state/editorStats';
import { insertWikilink, toggleTask, toggleWrap } from './formatting';

function fakeView(doc: string, from: number, to = from) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(from, to) });
  const view = {
    get state() {
      return state;
    },
    dispatch(arg: Transaction | TransactionSpec) {
      state = arg instanceof Transaction ? arg.state : state.update(arg).state;
    },
  };
  return view as unknown as EditorView & { state: EditorState };
}

describe('toggleWrap', () => {
  it('wraps a selection and unwraps it again', () => {
    const view = fakeView('make this bold', 5, 9);
    toggleWrap('**')(view);
    expect(view.state.doc.toString()).toBe('make **this** bold');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('this');
    toggleWrap('**')(view);
    expect(view.state.doc.toString()).toBe('make this bold');
  });

  it('unwraps when the markers are inside the selection', () => {
    const view = fakeView('a ~~gone~~ b', 2, 10);
    toggleWrap('~~')(view);
    expect(view.state.doc.toString()).toBe('a gone b');
  });

  it('inserts an empty pair at a cursor', () => {
    const view = fakeView('x', 1);
    toggleWrap('`')(view);
    expect(view.state.doc.toString()).toBe('x``');
    expect(view.state.selection.main.head).toBe(2);
  });
});

describe('insertWikilink', () => {
  it('links the selected text', () => {
    const view = fakeView('see Nebulae now', 4, 11);
    insertWikilink(view);
    expect(view.state.doc.toString()).toBe('see [[Nebulae]] now');
  });
});

describe('toggleTask', () => {
  it('cycles plain text, bullets and tasks', () => {
    const view = fakeView('buy milk', 0);
    toggleTask(view);
    expect(view.state.doc.toString()).toBe('- [ ] buy milk');
    toggleTask(view);
    expect(view.state.doc.toString()).toBe('- [x] buy milk');
    toggleTask(view);
    expect(view.state.doc.toString()).toBe('- [ ] buy milk');
    const bullet = fakeView('  - eggs', 0);
    toggleTask(bullet);
    expect(bullet.state.doc.toString()).toBe('  - [ ] eggs');
  });
});

describe('countWords', () => {
  it('ignores frontmatter and counts contractions as one word', () => {
    expect(countWords('---\ntags: [a, b]\n---\n# Title\nIt’s a small-world, isn’t it?').words).toBe(6);
  });

  it('counts an empty note as zero and ignores whitespace', () => {
    expect(countWords('')).toEqual({ words: 0, characters: 0 });
    expect(countWords('   \n\n')).toEqual({ words: 0, characters: 0 });
  });
});

describe('more formatting', () => {
  it('inserts an empty wikilink with the cursor between the brackets', () => {
    const view = fakeView('see  now', 4);
    insertWikilink(view);
    expect(view.state.doc.toString()).toBe('see [[]] now');
    expect(view.state.selection.main.head).toBe(6);
  });

  it('toggles highlight markers', () => {
    const view = fakeView('a glow b', 2, 6);
    toggleWrap('==')(view);
    expect(view.state.doc.toString()).toBe('a ==glow== b');
    toggleWrap('==')(view);
    expect(view.state.doc.toString()).toBe('a glow b');
  });
});

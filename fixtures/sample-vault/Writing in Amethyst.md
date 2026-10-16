---
created: 2026-10-01
tags: [meta, guide]
aliases: [Markdown Guide]
---
# Writing in Amethyst

Everything here is plain Markdown, so the same file opens in Obsidian. Press ⌘E to see this note in reading view.

## Formatting

**Bold** with ⌘B, *italic* with ⌘I, ~~strikethrough~~ with ⇧⌘X, `inline code` with ⇧⌘C, and ==highlights== with ⇧⌘H. Link a note with [[Welcome|double brackets]] or ⇧⌘K.

> [!tip] Callouts
> Start a quote with `[!tip]`, `[!warning]` or `[!note]` to turn it into a callout.

> [!warning] Renames are safe
> Renaming or moving a note rewrites every link that points to it.

## Lists and tasks

- [x] Press ⌘L to turn a line into a task
- [ ] Press it again to tick it off
- Plain bullets work too

## Images

Paste or drop an image into a note and it lands in `attachments/`:

![[crab-nebula.svg]]

## Math

Inline math like $e^{i\pi} + 1 = 0$, or a block:

$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$

## Tables

| Shortcut | What it does |
| --- | --- |
| ⌘E | Switch between editing and reading |
| ⌘G | Step into the graph |
| ⌘[ and ⌘] | Go back and forward |
| ⌘, | Open settings |

## Footnotes and comments

Footnotes collect at the bottom of the reading view.[^1] %%This comment only shows while you edit.%%

[^1]: Like this one.

```js
const sky = notes.map((note) => star(note));
```

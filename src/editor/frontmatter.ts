import { tags as t } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';

/**
 * Parses a leading `---` YAML block as one Frontmatter node, so its closing
 * fence isn't read as a setext heading underline.
 */
export const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true, style: t.meta }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || line.text.trimEnd() !== '---') return false;
        if (!/^([\w -]+:|---|\.\.\.)/.test(cx.peekLine())) return false;
        const start = cx.lineStart;
        while (cx.nextLine()) {
          const text = line.text.trimEnd();
          if (text === '---' || text === '...') {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('Frontmatter', start, end));
            return true;
          }
        }
        cx.addElement(cx.elt('Frontmatter', start, cx.prevLineEnd()));
        return true;
      },
    },
  ],
};

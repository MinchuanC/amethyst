// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { createMockBackend } from './mock';
import { UNRESOLVED_PREFIX } from './types';

describe('mock vault backend', () => {
  const api = createMockBackend();

  beforeAll(async () => {
    await api.openVault('/mock/sample-vault');
  });

  it('opens the sample vault and lists notes without .obsidian', async () => {
    const info = await api.currentVault();
    expect(info?.name).toBe('sample-vault');
    expect(info!.noteCount).toBeGreaterThan(10);
    const files = await api.listFiles();
    expect(files.some((f) => f.path === 'Welcome.md' && f.kind === 'note')).toBe(true);
    expect(files.some((f) => f.path === 'Astronomy' && f.kind === 'folder')).toBe(true);
    expect(files.every((f) => !f.path.includes('.obsidian'))).toBe(true);
  });

  it('resolves wikilinks, aliases and missing notes the way Obsidian does', async () => {
    expect(await api.resolveLink('Nebulae', 'Welcome.md')).toBe('Astronomy/Nebulae.md');
    expect(await api.resolveLink('Index', 'Astronomy/Galaxies.md')).toBe('Astronomy/Index.md');
    expect(await api.resolveLink('Missing Note', 'Welcome.md')).toBeNull();
  });

  it('returns backlinks, outgoing unresolved links and headings', async () => {
    const links = await api.noteLinks('Astronomy/Black Holes.md');
    expect(links.backlinks.some((b) => b.source === 'Astronomy/Galaxies.md')).toBe(true);
    expect(links.outgoing.some((o) => !o.resolved && o.title.toLowerCase().includes('relativity'))).toBe(true);
    expect(links.headings.length).toBeGreaterThan(0);
  });

  it('searches notes and finds unlinked mentions', async () => {
    const hits = await api.search('nebula');
    expect(hits[0].path).toBe('Astronomy/Nebulae.md');
    expect(hits[0].snippets.length).toBeGreaterThan(0);
    expect(await api.search('   ')).toEqual([]);
    const mentions = await api.unlinkedMentions('Astronomy/Telescopes.md');
    expect(mentions.some((m) => m.source.startsWith('Journal/'))).toBe(true);
  });

  it('creates, writes, duplicates via unique names, and deletes', async () => {
    const path = await api.createNote('Scratch/Idea', '# Idea\n');
    expect(path).toBe('Scratch/Idea.md');
    const again = await api.createNote('Scratch/Idea', '');
    expect(again).toBe('Scratch/Idea 1.md');
    await api.writeNote(path, '# Idea\nSee [[Pulsars]]\n');
    expect(await api.readNote(path)).toContain('[[Pulsars]]');
    const snap = await api.graphSnapshot();
    expect(snap.edges.some((e) => e.source === path && e.target === 'Astronomy/Pulsars.md')).toBe(true);
    await api.deletePath('Scratch');
    await expect(api.readNote(path)).rejects.toThrow(/Not found/);
  });

  it('renames a note and rewrites [[title]] links', async () => {
    const created = await api.createNote('Tmp/Original', '# Original\n');
    await api.writeNote('Welcome.md', `${await api.readNote('Welcome.md')}\n[[Original]]\n`);
    const result = await api.renamePath(created, 'Tmp/Renamed.md');
    expect(result.newPath).toBe('Tmp/Renamed.md');
    expect(result.updatedLinks).toBeGreaterThan(0);
    expect(await api.readNote('Welcome.md')).toContain('[[Renamed]]');
    await api.deletePath('Tmp');
  });

  it('turns a mention into a wikilink', async () => {
    const mentions = await api.unlinkedMentions('Astronomy/Telescopes.md');
    const m = mentions[0];
    expect(m).toBeTruthy();
    await api.linkMention(m.source, m.offset, m.length, 'Astronomy/Telescopes.md');
    expect(await api.readNote(m.source)).toMatch(/\[\[Telescopes/);
  });

  it('saves an attachment with a unique name and exposes an asset URL', async () => {
    const path = await api.saveAttachment('crab-nebula.svg', new TextEncoder().encode('<svg/>'), 'Astronomy/Nebulae.md');
    expect(path.startsWith('attachments/')).toBe(true);
    expect(api.assetUrl(path)).toMatch(/^(blob:|data:)/);
  });

  it('ranks similar notes and can emit ghost links', async () => {
    const similar = await api.similarNotes('Astronomy/Dark Matter.md', 5);
    expect(similar.length).toBeGreaterThan(0);
    expect(similar[0].path).not.toBe('Astronomy/Dark Matter.md');
    const ghosts = await api.ghostLinks(0.01);
    expect(ghosts.every((g) => g.source !== g.target)).toBe(true);
  });

  it('marks dangling links as unresolved nodes', async () => {
    const snap = await api.graphSnapshot();
    expect(snap.nodes.some((n) => n.id.startsWith(UNRESOLVED_PREFIX) && n.kind === 'unresolved')).toBe(true);
  });
});

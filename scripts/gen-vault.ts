// Usage: node scripts/gen-vault.ts <out-dir> [note-count] [seed]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateVault } from '../src/dev/synthVault.ts';

const [outDir, countArg, seedArg] = process.argv.slice(2);
if (!outDir) {
  console.error('Usage: node scripts/gen-vault.ts <out-dir> [note-count] [seed]');
  process.exit(1);
}
const count = Number(countArg ?? 10000);
const notes = generateVault(count, Number(seedArg ?? 7));
for (const note of notes) {
  const full = join(outDir, note.path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, note.content);
}
console.log(`Wrote ${notes.length} notes to ${outDir}`);

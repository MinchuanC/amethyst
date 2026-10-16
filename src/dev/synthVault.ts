/**
 * Generates a vault shaped like real ones: topic communities, a few heavily
 * linked hubs (preferential attachment), orphans, and dangling links.
 */
export interface SynthNote {
  path: string;
  content: string;
}

const TOPICS: { folder: string; words: string[] }[] = [
  { folder: 'Astronomy', words: ['star', 'orbit', 'nebula', 'comet', 'quasar', 'pulsar', 'galaxy', 'eclipse', 'parallax', 'redshift', 'corona', 'meteor'] },
  { folder: 'Computing', words: ['compiler', 'kernel', 'cache', 'thread', 'shader', 'buffer', 'protocol', 'lambda', 'vector', 'socket', 'parser', 'heap'] },
  { folder: 'Biology', words: ['cell', 'enzyme', 'protein', 'genome', 'neuron', 'mitosis', 'ribosome', 'membrane', 'symbiosis', 'species', 'fungus', 'pollen'] },
  { folder: 'Philosophy', words: ['ethics', 'virtue', 'logic', 'paradox', 'axiom', 'dialectic', 'meaning', 'mind', 'stoic', 'reason', 'truth', 'being'] },
  { folder: 'History', words: ['empire', 'treaty', 'dynasty', 'revolt', 'archive', 'harbor', 'guild', 'frontier', 'charter', 'siege', 'relic', 'trade'] },
  { folder: 'Music', words: ['chord', 'rhythm', 'timbre', 'cadence', 'motif', 'tempo', 'harmony', 'scale', 'fugue', 'drone', 'groove', 'octave'] },
  { folder: 'Design', words: ['grid', 'contrast', 'kerning', 'palette', 'texture', 'balance', 'form', 'signal', 'layer', 'motion', 'space', 'glyph'] },
  { folder: 'Cooking', words: ['broth', 'ferment', 'umami', 'crust', 'emulsion', 'spice', 'braise', 'dough', 'citrus', 'smoke', 'caramel', 'brine'] },
  { folder: 'Physics', words: ['quantum', 'entropy', 'field', 'photon', 'momentum', 'wave', 'plasma', 'spin', 'lattice', 'boson', 'flux', 'inertia'] },
  { folder: 'Journal', words: ['morning', 'walk', 'idea', 'letter', 'train', 'rain', 'coffee', 'dream', 'market', 'river', 'garden', 'night'] },
];

const ADJECTIVES = ['Quiet', 'Bright', 'Hidden', 'Folded', 'Distant', 'Silver', 'Hollow', 'Rapid', 'Ancient', 'Open', 'Mirrored', 'Slow', 'Electric', 'Lucid', 'Deep', 'Northern', 'Paper', 'Velvet'];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateVault(count: number, seed = 7): SynthNote[] {
  const rand = mulberry32(seed);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const communities = Math.min(TOPICS.length, Math.max(3, Math.round(Math.sqrt(count) / 3)));
  const titles: string[] = [];
  const community: number[] = [];
  const used = new Set<string>();
  const endpointsBy: number[][] = Array.from({ length: communities }, () => []);
  const endpoints: number[] = [];
  const links: number[][] = [];
  const start = Date.UTC(2023, 0, 1);
  const span = 1000 * 60 * 60 * 24 * 365 * 3;

  for (let i = 0; i < count; i++) {
    const c = Math.floor(Math.pow(rand(), 1.3) * communities);
    const topic = TOPICS[c];
    let title = `${pick(ADJECTIVES)} ${cap(pick(topic.words))}`;
    let n = 2;
    while (used.has(title.toLowerCase())) title = `${title.replace(/ \d+$/, '')} ${n++}`;
    used.add(title.toLowerCase());
    titles.push(title);
    community.push(c);

    const out: number[] = [];
    if (i > 0 && rand() > 0.05) {
      const m = 1 + Math.floor(Math.pow(rand(), 2) * 4);
      for (let k = 0; k < m; k++) {
        const pool = rand() < 0.86 && endpointsBy[c].length ? endpointsBy[c] : endpoints;
        const target = pool.length && rand() < 0.8 ? pool[Math.floor(rand() * pool.length)] : Math.floor(rand() * i);
        if (target !== i && !out.includes(target)) out.push(target);
      }
    }
    links.push(out);
    endpointsBy[c].push(i);
    endpoints.push(i);
    for (const t of out) {
      endpoints.push(t);
      endpointsBy[community[t]].push(t);
    }
  }

  return titles.map((title, i) => {
    const topic = TOPICS[community[i]];
    const created = new Date(start + (i / count) * span + rand() * 1000 * 60 * 60 * 24 * 5).toISOString().slice(0, 10);
    const sentence = () => {
      const words = Array.from({ length: 6 + Math.floor(rand() * 6) }, () => pick(topic.words));
      return cap(words.join(' ')) + '.';
    };
    const linkText = links[i].map((t) => `[[${titles[t]}]]`);
    if (rand() < 0.03) linkText.push(`[[${pick(ADJECTIVES)} ${cap(pick(topic.words))} Draft]]`);
    const body = [
      '---',
      `created: ${created}`,
      `tags: [${topic.folder.toLowerCase()}${rand() < 0.3 ? `, ${pick(topic.words)}` : ''}]`,
      '---',
      `# ${title}`,
      '',
      `${sentence()} ${sentence()}`,
      '',
      linkText.length ? `Related: ${linkText.join(', ')}` : '',
      '',
    ].join('\n');
    return { path: `${topic.folder}/${title}.md`, content: body };
  });
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

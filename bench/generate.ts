/**
 * Deterministic JSON generator for benchmarks. Same seed → identical document,
 * so timings are comparable across runs (and across engines).
 */

/** Tiny seeded LCG — we avoid Math.random for reproducibility. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
  'mike',
  'november',
  'oscar',
  'papa',
];

/**
 * Build a JSON value with roughly `targetNodes` nodes: an array of records,
 * each record contributing a fixed number of nodes (object + fields + nested
 * array/object).
 */
export function generate(targetNodes: number, seed = 0x9e3779b9): unknown {
  const rnd = lcg(seed);
  const word = () => WORDS[Math.floor(rnd() * WORDS.length)]!;

  // Nodes per record (counted to match the engine's preorder counting):
  //  record{} 1 + id 1 + name 1 + active 1 + score 1
  //  + tags[] 1 + 3 elems 3
  //  + meta{} 1 + created 1 + region 1 + nested{} 1 + nested.level 1 + nested.flag 1
  // = 16
  const NODES_PER_RECORD = 16;
  const records: unknown[] = [];
  // Root array(1) + records; aim for targetNodes total.
  const n = Math.max(1, Math.floor((targetNodes - 1) / NODES_PER_RECORD));

  for (let i = 0; i < n; i++) {
    records.push({
      id: i,
      name: `${word()}-${word()}`,
      active: rnd() > 0.5,
      score: Math.floor(rnd() * 100000),
      tags: [word(), word(), word()],
      meta: {
        created: 1_600_000_000 + Math.floor(rnd() * 50_000_000),
        region: word(),
        nested: { level: Math.floor(rnd() * 10), flag: rnd() > 0.7 },
      },
    });
  }
  return records;
}

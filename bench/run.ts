/**
 * Engine benchmark harness. Measures the operations that dominate the
 * tens-of-MB experience, in isolation from the UI, so a future WASM engine can
 * be compared against the TS one on the exact same workload.
 *
 *   node bench/bench.mjs [--nodes=1000000] [--engine=ts] [--runs=3]
 */
import { performance } from 'node:perf_hooks';
import { TsEngine } from '../src/engine/ts-engine';
import type { Engine } from '../src/engine/types';
import { generate } from './generate';

const ENGINES: Record<string, () => Engine> = {
  ts: () => new TsEngine(),
  // wasm: () => new WasmEngine(),   // ← drop in here when it lands
};

interface Args {
  nodes: number;
  engine: string;
  runs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string, d: string) =>
    argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  return {
    nodes: Number(get('nodes', '1000000')),
    engine: get('engine', 'ts'),
    runs: Number(get('runs', '3')),
  };
}

/** Median of an array of numbers. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Time `fn` `runs` times, return the median ms. */
function time(runs: number, fn: () => void): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

function mb(bytes: number): number {
  return bytes / 1024 / 1024;
}

function row(label: string, ms: number, extra = ''): void {
  console.log(`  ${label.padEnd(26)} ${ms.toFixed(2).padStart(9)} ms   ${extra}`);
}

const args = parseArgs(process.argv.slice(2));
const factory = ENGINES[args.engine];
if (!factory) {
  console.error(`Unknown engine "${args.engine}". Available: ${Object.keys(ENGINES).join(', ')}`);
  process.exit(1);
}

console.log(
  `\nJSONLens benchmark — engine=${args.engine}, target nodes=${args.nodes.toLocaleString()}, runs=${args.runs}\n`,
);

const value = generate(args.nodes);
const text = JSON.stringify(value);
const bytes = Buffer.byteLength(text, 'utf8');
console.log(`  document: ${mb(bytes).toFixed(1)} MB of JSON\n`);

// --- parse + build model (the hot startup path) ---
let engine!: Engine;
const heapBefore = process.memoryUsage().heapUsed;
const parseMs = time(args.runs, () => {
  engine = factory();
  const res = engine.parse(text);
  if (!res.ok) throw new Error('parse failed: ' + res.message);
});
const heapAfter = process.memoryUsage().heapUsed;
const nodeCount = engine.visibleCount();
row(
  'parse + index',
  parseMs,
  `${(mb(bytes) / (parseMs / 1000)).toFixed(0)} MB/s · ${nodeCount.toLocaleString()} nodes`,
);
console.log(
  `  ${'model heap (approx)'.padEnd(26)} ${`${mb(heapAfter - heapBefore).toFixed(0)} MB`.padStart(9)}      retained`,
);

// --- search ---
row(
  'search (key hit)',
  time(args.runs, () => engine.search('region', false)),
);
row(
  'search (key+value)',
  time(args.runs, () => engine.search('alpha', true)),
);

// --- whole-tree visibility ---
row(
  'collapse all',
  time(args.runs, () => engine.toggleAll(true)),
);
row(
  'expand all',
  time(args.runs, () => engine.toggleAll(false)),
);
row(
  'collapseToDepth(1)',
  time(args.runs, () => engine.collapseToDepth(1)),
);
engine.toggleAll(false);

// --- scroll simulation: fetch 1000 viewport windows across the document ---
const WINDOWS = 1000;
const WINDOW = 50;
const visible = engine.visibleCount();
const scrollMs = time(args.runs, () => {
  for (let i = 0; i < WINDOWS; i++) {
    const start = Math.floor((i / WINDOWS) * Math.max(0, visible - WINDOW));
    engine.getRows(start, WINDOW);
  }
});
row('scroll (1000 windows)', scrollMs, `${((WINDOWS / scrollMs) * 1000).toFixed(0)} windows/s`);

// --- reveal a deep node ---
const deep = engine.search('flag', false);
if (deep.length) {
  engine.collapseToDepth(0);
  row(
    'reveal deep node',
    time(args.runs, () => engine.reveal(deep[deep.length - 1]!.id)),
  );
  engine.toggleAll(false);
}

console.log('');

// Bundles the TS benchmark with esbuild, then runs it. Keeps the harness in TS
// (sharing the real engine source) without a separate build step.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = await import(require.resolve('esbuild'));

await esbuild.build({
  entryPoints: ['bench/run.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'node_modules/.cache/jl-bench.mjs',
});

// Forward CLI args (e.g. --nodes=2000000) to the bundled script.
process.argv = [process.argv[0], 'bench', ...process.argv.slice(2)];
await import('../node_modules/.cache/jl-bench.mjs');

# JSONLens

A Chrome (MV3) extension that takes over raw JSON pages and renders them as a
fast, virtualized, searchable tree — built to stay smooth on **tens of MB** of
JSON.

## Why it's fast

The expensive work never touches the DOM or the main thread:

- **Parse + index in a Web Worker.** `JSON.parse` runs off the UI thread, then
  the value tree is walked **once** into a preorder, struct-of-arrays model
  (typed arrays for kind/depth/parent/subtree-size/…).
- **O(log n) collapse / expand / scroll.** A [Fenwick tree](src/shared/fenwick.ts)
  over a per-node "visible" bit gives `findKth` (row → node) and `prefix`
  (node → row) in `O(log n)`, so toggling a subtree costs only the rows that
  actually appear or disappear — not a full re-scan.
- **Windowed rendering.** The viewer renders only the ~viewport rows, fetching
  slices from the worker on scroll.

## Architecture

Deep dive: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (also in Russian:
[docs/ARCHITECTURE.ru.md](docs/ARCHITECTURE.ru.md)). Engine benchmarks:
**[bench/](bench/README.md)**.

```
content.tsx  → detects a JSON document, replaces the page, mounts the viewer
  viewer/    → Preact UI: toolbar, search, virtualized tree (engineClient ⇄ worker)
  worker/    → runs the Engine off-thread (message protocol)
  engine/    → Engine interface + TsEngine (flat model, Fenwick-backed)
  shared/    → Fenwick tree
```

### The engine boundary (and Rust/WASM later)

The UI only ever asks for **rows by index** and **opaque node ids** — never a
materialized object tree (see [`Engine`](src/engine/types.ts)). That boundary is
deliberately zero-copy-friendly: the current `TsEngine` can be swapped for a
`WasmEngine` (Rust + `serde_json`/`simd-json` parsing straight into linear
memory) without the viewer changing. Phase 2.

## Features

- Tree view with syntax coloring, collapse/expand, expand/collapse all,
  collapse-to-depth.
- Incremental **search** over keys (and optionally values) with next/prev
  navigation and auto-reveal.
- **Copy** value, JS access path (`a.b[0]`), or JSONPath (`$['a']['b'][0]`) per
  node.
- **Raw** mode toggle.

## Develop

```bash
pnpm install
pnpm dev            # vite dev (HMR for the viewer)
pnpm build          # typecheck + production build → dist/
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint (flat config)
pnpm format         # prettier --write
pnpm test           # vitest unit tests (engine + Fenwick)
pnpm coverage       # vitest with v8 coverage
pnpm e2e            # Playwright E2E in real Chrome with the extension loaded
```

E2E needs the full Chromium once: `pnpm exec playwright install chromium --no-shell`.

Load `dist/` via `chrome://extensions` → "Load unpacked".

## Status

MVP — pure-TS engine. Next: Rust/WASM engine behind the same interface, then
value-search index for sub-100ms search on millions of nodes.

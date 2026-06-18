# JSONLens — Roadmap

## Done (MVP)

- MV3 Chrome extension scaffold (Vite + TS + Preact + @crxjs).
- Worker-based engine; preorder struct-of-arrays model; Fenwick-backed
  O(log n) collapse/expand/scroll.
- Features: tree view, search (keys + optional values, next/prev, auto-reveal),
  copy value / JS path / JSONPath, expand/collapse all + to-depth, Tree ↔ Raw.
- Tooling: ESLint (flat) + Prettier + EditorConfig; Vitest unit tests +
  Playwright E2E (real Chrome, extension loaded).
- `pnpm typecheck` / `lint` / `test` / `e2e` / `build` all green.

## Next

### Phase 2 — Rust/WASM engine

- Implement `WasmEngine` behind the existing `Engine` interface
  (`src/engine/types.ts`).
- Rust parse with `serde_json` / `simd-json` straight into linear memory
  (struct-of-arrays in WASM heap) — kills GC pressure and the double-memory of
  keeping the parsed JS tree.
- UI reads rows by index; stays zero-copy. No viewer changes.
- Toolchain: `wasm-pack` + `cargo` (not yet installed locally).

### Phase 3 — search at scale

- Current `search` is O(n) string scan; freezes on millions of nodes.
- Pre-build a lowercased value/key index (or incremental/cancelable scan with
  progress) for sub-100ms search.

### Phase 4 — Raw mode polish

- Separate prettify / minify toggle (needs re-serialize via worker).
- Virtualize Raw mode (a single <pre> of tens of MB is heavy).

### Phase 5 — refactors surfaced by /simplify + /code-review

Bigger, behavior-sensitive cleanups intentionally deferred from the quality pass:

- **Generic, method-derived worker protocol (altitude).** Today every engine op
  is transcribed 5× (Engine method, `Req`, `Res`, worker `case`, client method).
  Derive `Req`/`Res` from the `Engine` type
  (`{ [M in keyof Engine]: { t: M; args: Parameters<Engine[M]> } }`) so the
  worker is one generic `engine[t](...args)` dispatcher and `EngineClient` a
  single `call(method, ...args)` proxy. Prereq: fold `copy` back into engine
  (`copyText(id, what)` or compose `valueOf`/`pathOf` client-side) and unify the
  "visible count changed" result across all mutating ops (drop the bespoke
  `reveal` response shape + the side `visibleCount()` call in the worker).
- **Range-update Fenwick (efficiency, biggest win).** Collapse/expand of a large
  subtree is O(subtree·log n) because of per-node point updates. A collapsed
  subtree is a contiguous preorder range → use a range-update/point-query Fenwick
  to make a toggle O(log n).
- **Lazy preview (efficiency).** `previewPrimitive` (incl. `JSON.stringify` on
  every string) currently runs for _all_ nodes at parse and retains millions of
  preview strings. Compute it in `rowAt` for only the ~visible rows (values are
  already in `valueRef`); search would read from `valueRef` too.
- **Drop the per-node `valueRef` array.** Resolve value/path on demand by walking
  `parent`/`keys` down from `root` (the WASM phase removes it entirely).
- **Single-pass flatten.** Replace the `countNodes` pre-walk with geometric
  growth of the typed arrays — one O(n) traversal instead of two.
- **Search precompute / streaming.** Precompute lowercased keys+previews once (or
  cancelable incremental scan) and cap/stream hit count.
- **Memoize `RowView`** + stabilize `onToggle`/`onCopy` (`useEvent`) and pass
  primitive `matched`/`active` so the virtualized window only re-renders changed
  rows; rAF-coalesce scroll-driven `getRows`.

### Known limitations (from /code-review, not yet addressed)

- **Value search is preview-based.** Strings are searched against their
  truncated (200-char) `JSON.stringify` preview, so matches past 200 chars, or
  on raw (unescaped) content, are missed. Numbers are matched as `String(value)`,
  which differs from the source spelling (`1e100` → `1e+100`, big ints rounded).
  Fix lands with the search-precompute phase.
- **Copy/preview reflect the parsed value, not the source text** — duplicate
  keys collapsed and integer-like object keys reordered by JS semantics. Matches
  what's displayed (both use `Object.keys`), but differs from the raw bytes.
- **Strict-CSP / Trusted-Types pages** may block the module worker; the page is
  restored on parse failure but a CSP-blocked worker is a separate gap.

### Backlog

- Firefox port (webextension-polyfill, manifest deltas).
- Persisted UI prefs (valuesToo, default depth) via `storage`.
- Keyboard nav across rows; click-to-select + breadcrumb of current path.
- Big-string / big-array lazy preview & "load more" for huge arrays.

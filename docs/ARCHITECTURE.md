# JSONLens — Architecture

A deep dive into how JSONLens renders **tens of megabytes** of JSON smoothly, and
_why_ each piece is built the way it is. If you only read one section, read
[The core idea](#the-core-idea).

---

## The problem

A naïve JSON viewer does two things that fall apart at scale:

1. **`JSON.parse` on the main thread.** Parsing 30 MB takes ~150–400 ms and
   spikes memory: every object/array/string becomes a heap-allocated JS value
   with per-object header overhead, so 30 MB of _text_ can become 150–300 MB of
   _heap_. On the UI thread this freezes the tab.
2. **One DOM node per JSON node.** A 30 MB document is millions of JSON nodes.
   Building a `<div>` per node is millions of layout boxes — the browser dies
   long before the user can scroll.

Everything below exists to avoid these two traps.

---

## The core idea

> **Parse once, off-thread, into a flat indexed model. Render only the rows in
> the viewport. Make collapse/expand/scroll cost `O(log n)`, never `O(n)`.**

Concretely:

- The data lives in a **Web Worker**, as a **preorder, struct-of-arrays** model
  built from typed arrays — not a tree of JS objects.
- The UI is a thin **virtualized list**: it asks the worker for "the visible
  rows in `[start, start+count)`" and renders ~50 DOM nodes regardless of
  document size.
- A **Fenwick tree** (binary indexed tree) over a per-node "is visible" bit lets
  us map _row index → node_ and _node → row index_ in `O(log n)`, and flip a
  whole subtree's visibility in time proportional to the rows that actually
  appear/disappear.

The UI never sees a materialized object tree. It only ever handles **rows by
index** and **opaque node ids**. That boundary is what lets a Rust/WASM engine
drop in later without touching the viewer.

---

## Pipeline overview

```
 raw JSON page
      │
      ▼
┌───────────────────┐   detects a JSON document, replaces the page,
│  content script   │   mounts the Preact viewer (or restores on bad JSON)
│  content/content  │
└─────────┬─────────┘
          │ document text
          ▼
┌───────────────────┐   Preact UI: toolbar, search, virtualized tree.
│   viewer (App)    │   Talks to the worker via EngineClient (promises over
│  viewer/*.tsx     │   postMessage), renders only viewport rows.
└─────────┬─────────┘
          │ messages (parse / getRows / toggle / search / reveal / copy / serialize)
          ▼
┌───────────────────┐   runs the Engine off the main thread.
│   Web Worker      │
│  worker/*.ts      │
└─────────┬─────────┘
          │ Engine interface
          ▼
┌───────────────────┐   JSON.parse → preorder struct-of-arrays model;
│   TsEngine        │   Fenwick-backed visibility. (Swappable for WasmEngine.)
│  engine/*.ts      │
└───────────────────┘
```

---

## 1. Content script — detect & take over

`src/content/content.tsx` runs at `document_end` on every page (the manifest
matches `<all_urls>`), but bails immediately unless the page is actually JSON:

- It only inspects `body.textContent` when the page **could** be JSON — i.e. the
  content type is in the JSON family (`application/json`, `text/json`, or any
  `+json` structured suffix) **or** the body is a single `<pre>` (the shape
  browsers use to render raw text). This avoids serializing the entire DOM of
  every ordinary HTML page just to throw it away.
- For a non-JSON content type it additionally requires the text to be
  _structural_ (`{…}` / `[…]`) so we don't hijack arbitrary `text/plain`.

**Restore-on-failure.** Detection is a cheap shape check, not a full parse. So
`mount()` **keeps the original document nodes**, clears the page, renders the
viewer, and passes an `onParseError` callback. If the worker later reports the
text isn't valid JSON, the viewer calls back and the original page is restored —
no irrecoverable blank page from a `Content-Type: application/json` that's
actually an HTML error body.

---

## 2. The worker boundary

The engine runs in a `Worker` so parsing and indexing never touch the UI thread.

`EngineClient` (`src/viewer/engineClient.ts`) wraps the raw message port in a
promise API: each request gets a correlation id, and the matching response
resolves its promise. Worker-side exceptions come back as an `error` response
that **rejects** the pending promise, and a `worker.onerror` handler rejects
everything in flight — so a thrown engine never leaves the UI hanging on a
spinner.

### Why a Blob worker (the non-obvious part)

A content script's document origin is the _host page_ (e.g. `https://site.com`).
A `Worker` script must be same-origin; even a web-accessible
`chrome-extension://…` URL is **blocked** for worker construction from a content
script. And `new Worker(new URL('…', import.meta.url))` doesn't work either —
content scripts aren't ES modules, so `import.meta` throws.

The engine worker bundle is fully **self-contained** (zero imports), so the
client **fetches its code** via `chrome.runtime.getURL(...)` and runs it from a
same-origin **Blob URL**:

```ts
const code = await (await fetch(chrome.runtime.getURL(workerUrl))).text();
const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
```

This was caught by the Playwright E2E test — without it the extension silently
never mounted.

---

## 3. The flat model (the heart)

`TsEngine.parse` (`src/engine/ts-engine.ts`) runs `JSON.parse` once, then walks
the value tree **once** into parallel typed arrays — a struct-of-arrays layout
indexed by node id (the node's **preorder position**):

| array         | type          | meaning                                      |
| ------------- | ------------- | -------------------------------------------- |
| `kind`        | `Uint8Array`  | Object/Array/String/Number/Bool/Null         |
| `depth`       | `Uint32Array` | indentation level                            |
| `parent`      | `Int32Array`  | parent node id (`-1` for root)               |
| `childCount`  | `Uint32Array` | number of children (0 for primitives)        |
| `subtreeSize` | `Uint32Array` | nodes in this subtree, **including itself**  |
| `collapsed`   | `Uint8Array`  | is this container collapsed                  |
| `visible`     | `Uint8Array`  | is this node currently rendered              |
| `keys`        | `string[]`    | object member key / array index label        |
| `keyIsIndex`  | `Uint8Array`  | distinguishes array indices from string keys |
| `preview`     | `string[]`    | display-ready primitive text                 |
| `valueRef`    | `unknown[]`   | reference to the live JS sub-value (copy)    |

**Why struct-of-arrays + typed arrays?** Numbers live in contiguous typed-array
buffers instead of millions of boxed JS objects, which slashes per-node overhead
and GC pressure — the exact thing that kills the naïve approach. It's also the
layout a WASM engine wants (the same columns map to linear memory).

### Preorder = contiguous subtrees

The single most useful invariant: because nodes are numbered in **preorder**, a
node's entire subtree occupies the contiguous id range
`[i, i + subtreeSize[i])`. That means:

- "Collapse node `i`" = "hide the range `(i, i + subtreeSize[i])`."
- "Skip a collapsed subtree" = "jump from `i` to `i + subtreeSize[i]`."

No child pointers or recursion needed to walk or skip subtrees.

### Iterative, bounded-stack construction

Both the node-count pass and the flatten pass use an **explicit cursor stack**
bounded by tree _depth_ (not breadth), so a 10M-element array doesn't blow the
call stack. `subtreeSize[i]` is filled when a container's cursor is exhausted:
`subtreeSize[i] = nextId - i`.

---

## 4. Fenwick tree — O(log n) everything

The viewport needs two mappings, constantly:

- **row → node**: "what node sits at visible row 12,034?" (on scroll)
- **node → row**: "what row is this node on?" (after reveal / to highlight)

and collapse/expand must update them. A flat "list of visible ids" would make
each toggle an `O(n)` rebuild. Instead we keep a
[Fenwick tree](../src/shared/fenwick.ts) over the `visible` bit array:

- `prefix(i)` — number of visible nodes in `[0, i]` → **node → row** is
  `prefix(id) - 1`.
- `findKth(k)` — the node id at visible row `k` (a lower-bound descent over the
  tree) → **row → node**.
- `update(i, ±1)` — flip one node's visibility.

All three are `O(log n)`. `initFrom` builds the tree in `O(n)` (used on whole-
tree ops like expand/collapse-all).

### Collapse / expand cost

`setCollapsed(i, collapse)` walks the subtree of `i` but **skips nested
collapsed subtrees** (jumping by `subtreeSize`), touching only the rows that
actually change visibility, with one `O(log n)` Fenwick update each. So
collapsing a node that hides _k_ visible rows costs `O(k · log n)` — proportional
to what changed, not to the document. (A future range-update Fenwick would make
it a flat `O(log n)`; see `PLANS.md`.)

---

## 5. Virtualization

`VirtualTree.tsx` renders a spacer of height `visibleCount × ROW_H` so the
scrollbar reflects the full document, but only materializes the rows in view:

1. On scroll (or model change), compute the first visible row from `scrollTop`,
   plus an overscan margin.
2. Ask the worker for that window via `getRows(start, count)`.
3. Absolutely-position each returned row at `rowIndex × ROW_H`.

A monotonically increasing **request token** discards stale `getRows` responses
that arrive out of order during fast scrolling. `count` is clamped to `≥ 0` so a
model that shrinks under the scroll position (e.g. collapse-all while scrolled
down) can't request a negative window.

Fixed row height (`ROW_H`) is what keeps virtualization arithmetic `O(1)` — no
per-row measurement.

### Closing-bracket rows

Each expanded container also renders a closing `}` / `]` on its own line, so the
display row space is **visible nodes + visible expanded containers**, not just
nodes. A second Fenwick (`closeFen`, over a `closeWeight` bit per node) counts
those closing rows; `visibleCount = nodeFen.count + closeFen.count` drives the
spacer height. `getRows` seeks to a display index by binary-searching the
opener's display index `DI(X) = visibleRank(X) + closeFen.prefixExclusive(X) −
depth(X)` (the `− depth` falls out because a visible node's ancestors are all
still-open containers), then forward-walks a DFS reconstruction that interleaves
closing rows as containers end. Closing rows carry `close: true` and the
container's node id; the model stays one-node-per-entry — closers are derived,
never stored.

## 6. Features, mapped to the model

- **Search** — `engine.search(query, valuesToo)` scans keys (and primitive
  previews) and returns ordered hit node ids; the UI highlights them and
  `reveal()` expands collapsed ancestors to bring the active hit on-screen.
- **Copy** — `valueOf(id)` returns the live JS sub-value (serialized for copy);
  `pathOf(id, flavor)` walks `parent`/`keys` to build a JS (`a.b[0]`) or JSONPath
  (`$['a']['b'][0]`) string, with proper escaping for keys that need it.
- **Download** — `serialize(true)` re-stringifies the whole document **in the
  worker** (so a multi-MB serialize never blocks the UI) and saves it as a
  pretty-printed `.json` file via a transient blob URL.
- **Collapse/expand all & to-depth** — whole-tree visibility recomputed in
  `O(n)` and the Fenwick rebuilt with `initFrom`.

---

## 7. The engine boundary (and Rust/WASM)

`Engine` (`src/engine/types.ts`) is deliberately narrow and zero-copy-friendly:
`getRows`, `toggle`, `search`, `reveal`, `pathOf`, `serialize`, … — **indices,
ids, and whole-document strings only**, never object trees. `TsEngine` is one implementation; a `WasmEngine` (Rust +
`serde_json`/`simd-json` parsing straight into linear memory) can implement the
same interface and be swapped in the worker with **no viewer changes**. That's
the whole point of the boundary, and why the benchmark harness
([`bench/`](../bench)) measures the engine in isolation — so a WASM port's wins
(or losses) are directly visible.

---

## Complexity summary

| operation               | cost                      |
| ----------------------- | ------------------------- |
| parse + build model     | `O(n)` (off-thread)       |
| `getRows(start, count)` | `O(count · log n)`        |
| `rowOf` / `findKth`     | `O(log n)`                |
| toggle one node         | `O(rows changed · log n)` |
| collapse/expand all     | `O(n)`                    |
| search                  | `O(n)` (per query)        |

Where `n` = total node count.

---

## Known trade-offs

See **Known limitations** in [`PLANS.md`](../PLANS.md): preview-based value
search (truncated at 200 chars, numbers reformatted), copy/preview reflecting the
parsed value rather than source bytes (duplicate keys collapsed, integer-like
keys reordered), and strict-CSP pages potentially blocking the Blob worker. Each
has a planned fix; none compromises the core model.

# Benchmarks

Measures the engine operations that dominate the tens-of-MB experience, **in
isolation from the UI**, so the future Rust/WASM engine can be compared against
the TS one on the exact same workload.

```bash
pnpm bench                                  # 1M nodes (~10 MB), TS engine
node bench/bench.mjs --nodes=3000000        # ~30 MB
node bench/bench.mjs --engine=wasm --runs=5 # once WasmEngine lands
```

Flags: `--nodes` (target node count), `--engine` (`ts`, later `wasm`), `--runs`
(samples; the **median** is reported). The document is generated deterministically
from a fixed seed, so runs are comparable.

## What's measured

| metric                  | why it matters                                   |
| ----------------------- | ------------------------------------------------ |
| **parse + index**       | the hot startup path; MB/s + retained model heap |
| **search** (key, value) | currently `O(n)` per query — a prime WASM target |
| **collapse/expand all** | `O(n)` Fenwick rebuild                           |
| **collapseToDepth**     | whole-tree visibility recompute                  |
| **scroll**              | 1000 viewport windows — the per-frame hot path   |
| **reveal**              | expand ancestors of a deep node                  |

## Baseline (TS engine)

Indicative numbers on an Apple-silicon laptop, Node 24, median of 3 runs.
Re-run on your own machine before comparing — only **relative** deltas matter.

| document      | parse + index      | model heap | search key | search key+value | collapse all | scroll (1000 win) |
| ------------- | ------------------ | ---------- | ---------- | ---------------- | ------------ | ----------------- |
| ~10 MB (0.9M) | ~90 ms (116 MB/s)  | ~146 MB    | ~7 ms      | ~19 ms           | ~2 ms        | ~1 ms             |
| ~32 MB (2.8M) | ~285 ms (112 MB/s) | ~247 MB    | ~25 ms     | ~56 ms           | ~6 ms        | ~1 ms             |

### Reading the results

- **parse + index** and **model heap** are where a WASM engine should win big:
  parsing into linear memory avoids the boxed-JS-value overhead that drives the
  ~150–250 MB heap and the parse time.
- **search** is `O(n)` and re-lowercases strings per query — a clear WASM /
  precompute target.
- **collapse/expand/scroll** are already sub-10 ms; WASM won't move them much.
  If a WASM port _regresses_ these, the message-passing/marshalling overhead is
  the suspect.

When the WASM engine lands, run both and diff the columns — that's the whole
reason this harness exists.

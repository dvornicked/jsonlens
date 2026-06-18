/**
 * Fenwick (binary indexed) tree over a 0/1 "is this node visible" bit per node,
 * laid out in preorder. Gives us:
 *   - O(log n) prefix sums      → row index of a node id
 *   - O(log n) find-kth         → node id at a given visible-row index
 *   - O(log n) point updates    → flip a node's visibility on collapse/expand
 *
 * This is what makes collapse/expand and scrolling O(log n) instead of O(n)
 * over a model with millions of nodes.
 */
export class Fenwick {
  private readonly n: number;
  private readonly tree: Int32Array;
  private total = 0;

  constructor(size: number) {
    this.n = size;
    this.tree = new Int32Array(size + 1);
  }

  /** Bulk-initialize from a 0/1 array in O(n) (linear build). */
  initFrom(bits: Uint8Array): void {
    const t = this.tree;
    t.fill(0);
    let sum = 0;
    for (let i = 1; i <= this.n; i++) {
      const b = bits[i - 1]!;
      sum += b;
      t[i]! += b;
      const j = i + (i & -i);
      if (j <= this.n) t[j]! += t[i]!;
    }
    this.total = sum;
  }

  /** Add delta (+1/-1) at 0-based index. */
  update(index: number, delta: number): void {
    this.total += delta;
    for (let i = index + 1; i <= this.n; i += i & -i) this.tree[i]! += delta;
  }

  /** Sum of bits in [0, index] (1-based prefix of length index+1). */
  prefix(index: number): number {
    let s = 0;
    for (let i = index + 1; i > 0; i -= i & -i) s += this.tree[i]!;
    return s;
  }

  get count(): number {
    return this.total;
  }

  /**
   * Smallest 0-based index whose inclusive prefix sum is >= k+1 — i.e. the node
   * id sitting at visible-row k. Returns -1 if k is out of range.
   */
  findKth(k: number): number {
    if (k < 0 || k >= this.total) return -1;
    let pos = 0;
    let remaining = k + 1;
    let logn = 1;
    while (logn << 1 <= this.n) logn <<= 1;
    for (let step = logn; step > 0; step >>= 1) {
      const next = pos + step;
      if (next <= this.n && this.tree[next]! < remaining) {
        pos = next;
        remaining -= this.tree[next]!;
      }
    }
    return pos; // 0-based node index
  }
}

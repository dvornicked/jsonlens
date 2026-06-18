import { describe, expect, it } from 'vitest';
import { Fenwick } from './fenwick';

/** Brute-force reference for prefix sums over a bit array. */
function refPrefix(bits: number[], index: number): number {
  let s = 0;
  for (let i = 0; i <= index; i++) s += bits[i]!;
  return s;
}

function build(bits: number[]): Fenwick {
  const f = new Fenwick(bits.length);
  f.initFrom(Uint8Array.from(bits));
  return f;
}

describe('Fenwick.initFrom + prefix', () => {
  it('matches a brute-force prefix sum at every index', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    const f = build(bits);
    for (let i = 0; i < bits.length; i++) {
      expect(f.prefix(i)).toBe(refPrefix(bits, i));
    }
  });

  it('reports the total as the sum of all bits', () => {
    expect(build([1, 0, 1, 1]).count).toBe(3);
    expect(build([0, 0, 0]).count).toBe(0);
    expect(build([1]).count).toBe(1);
  });
});

describe('Fenwick.findKth', () => {
  it('returns the node index at each visible-row position', () => {
    const bits = [0, 1, 0, 1, 1]; // visible nodes at indices 1, 3, 4
    const f = build(bits);
    expect(f.findKth(0)).toBe(1);
    expect(f.findKth(1)).toBe(3);
    expect(f.findKth(2)).toBe(4);
  });

  it('returns -1 for out-of-range k', () => {
    const f = build([0, 1, 0]);
    expect(f.findKth(-1)).toBe(-1);
    expect(f.findKth(1)).toBe(-1); // only 1 visible bit
  });

  it('round-trips: findKth then prefix gives back the row', () => {
    const bits = [1, 0, 0, 1, 1, 0, 1];
    const f = build(bits);
    for (let k = 0; k < f.count; k++) {
      const id = f.findKth(k);
      expect(f.prefix(id) - 1).toBe(k);
    }
  });

  it('handles n=1', () => {
    expect(build([1]).findKth(0)).toBe(0);
    expect(build([0]).findKth(0)).toBe(-1);
  });
});

describe('Fenwick.update', () => {
  it('keeps prefix and total consistent after toggling bits off and on', () => {
    const bits = [1, 1, 1, 1, 1];
    const f = build(bits);
    f.update(2, -1); // hide index 2
    expect(f.count).toBe(4);
    expect(f.prefix(4)).toBe(4);
    expect(f.findKth(2)).toBe(3); // index 2 skipped
    f.update(2, +1); // show it again
    expect(f.count).toBe(5);
    expect(f.findKth(2)).toBe(2);
  });
});

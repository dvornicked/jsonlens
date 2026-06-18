import { describe, expect, it } from 'vitest';
import { TsEngine } from './ts-engine';
import { Kind } from './types';

function parse(value: unknown): TsEngine {
  const e = new TsEngine();
  const res = e.parse(JSON.stringify(value));
  if (!res.ok) throw new Error('parse failed: ' + res.message);
  return e;
}

/** All visible rows in order, as {depth,key,kind} for easy assertions. */
function rows(e: TsEngine) {
  return e.getRows(0, e.visibleCount()).map((r) => ({ depth: r.depth, key: r.key, kind: r.kind }));
}

const DOC = {
  user: { name: 'Ann', age: 30, tags: ['a', 'b', 'c'] },
  active: true,
  meta: null,
  items: [{ id: 1 }, { id: 2 }],
};

describe('parse + model', () => {
  it('counts every node once in preorder', () => {
    const e = parse(DOC);
    expect(e.visibleCount()).toBe(15);
    expect(rows(e)[0]).toEqual({ depth: 0, key: null, kind: Kind.Object });
    expect(rows(e)[1]).toEqual({ depth: 1, key: 'user', kind: Kind.Object });
  });

  it('reports a parse error with message and position', () => {
    const e = new TsEngine();
    const res = e.parse('{ "a": }');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/JSON|token|position/i);
  });

  it.each([
    ['object', { a: 1 }, Kind.Object],
    ['array', [1, 2], Kind.Array],
    ['number', 42, Kind.Number],
    ['string', 'hi', Kind.String],
    ['bool', true, Kind.Bool],
    ['null', null, Kind.Null],
  ])('handles a %s root', (_name, value, kind) => {
    const e = parse(value);
    expect(e.getRows(0, 1)[0]!.kind).toBe(kind);
  });

  it('marks empty containers as non-expandable', () => {
    const e = parse({ o: {}, a: [] });
    const oRow = e.getRows(0, 99).find((r) => r.key === 'o')!;
    expect(oRow.kind).toBe(Kind.Object);
    expect(oRow.expandable).toBe(false);
    expect(oRow.childCount).toBe(0);
  });
});

describe('collapse / expand', () => {
  it('collapsing a node hides exactly its descendants', () => {
    const e = parse(DOC);
    const userId = e.search('user', false)[0]!.id;
    const before = e.visibleCount();
    expect(e.toggle(userId, true)).toBe(before - 6); // user has 6 descendants
    expect(e.rowOf(e.search('tags', false)[0]!.id)).toBe(-1); // hidden
  });

  it('expanding restores them', () => {
    const e = parse(DOC);
    const userId = e.search('user', false)[0]!.id;
    e.toggle(userId, true);
    expect(e.toggle(userId, false)).toBe(15);
  });

  it('toggle is a no-op on an empty container', () => {
    const e = parse({ o: {} });
    const oId = e.search('o', false)[0]!.id;
    const before = e.visibleCount();
    expect(e.toggle(oId, true)).toBe(before);
    expect(e.getRows(0, 99).find((r) => r.id === oId)!.collapsed).toBe(false);
  });

  it('collapse all leaves only the root; expand all restores everything', () => {
    const e = parse(DOC);
    expect(e.toggleAll(true)).toBe(1);
    expect(e.toggleAll(false)).toBe(15);
  });

  it('collapseToDepth(1) shows the root and its direct members', () => {
    const e = parse(DOC);
    expect(e.collapseToDepth(1)).toBe(5); // root + 4 members
    expect(rows(e).every((r) => r.depth <= 1)).toBe(true);
  });
});

describe('reveal', () => {
  it('expands collapsed ancestors so a hidden node becomes visible', () => {
    const e = parse(DOC);
    const tagsId = e.search('tags', false)[0]!.id;
    e.toggle(e.search('user', false)[0]!.id, true);
    expect(e.rowOf(tagsId)).toBe(-1);
    const row = e.reveal(tagsId);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(e.rowOf(tagsId)).toBe(row);
  });
});

describe('search', () => {
  it('finds keys, not array indices', () => {
    const e = parse(DOC);
    expect(e.search('tags', false).map((h) => h.where)).toEqual(['key']);
    // "1" appears as an array index label but must not match as a key.
    expect(e.search('1', false)).toEqual([]);
  });

  it('finds values only when enabled', () => {
    const e = parse(DOC);
    expect(e.search('Ann', false)).toEqual([]);
    const hits = e.search('Ann', true);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.where).toBe('value');
  });

  it('is case-insensitive', () => {
    const e = parse(DOC);
    expect(e.search('USER', false)).toHaveLength(1);
  });
});

describe('pathOf + valueOf', () => {
  it('builds JS and JSONPath access paths', () => {
    const e = parse(DOC);
    const tagsId = e.search('tags', false)[0]!.id;
    expect(e.pathOf(tagsId, 'js')).toBe('user.tags');
    expect(e.pathOf(tagsId, 'jsonpath')).toBe("$['user']['tags']");
    expect(e.pathOf(tagsId + 2, 'js')).toBe('user.tags[1]'); // tags[1]
    expect(e.valueOf(tagsId + 2)).toBe('b');
  });

  it('escapes non-identifier keys in JS paths', () => {
    const e = parse({ 'a-b': { '1x': 1 } });
    const id = e.search('1x', false)[0]!.id;
    expect(e.pathOf(id, 'js')).toBe('["a-b"]["1x"]');
  });

  it('escapes quotes and backslashes in JSONPath', () => {
    const e = parse({ "a'b\\c": 1 });
    const id = e.search("a'b", false)[0]!.id;
    expect(e.pathOf(id, 'jsonpath')).toBe("$['a\\'b\\\\c']");
  });

  it('treats a numeric-string object key as a key, not an index', () => {
    const e = parse({ '0': 'x' });
    const id = e.search('0', false)[0]!.id;
    expect(e.pathOf(id, 'js')).toBe('["0"]');
    expect(e.pathOf(id, 'jsonpath')).toBe("$['0']");
  });

  it('returns the materialized value for copy', () => {
    const e = parse(DOC);
    const userId = e.search('user', false)[0]!.id;
    expect(e.valueOf(userId)).toEqual(DOC.user);
  });
});

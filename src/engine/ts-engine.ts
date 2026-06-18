import { Fenwick } from '../shared/fenwick';
import { Kind, type Engine, type ParseResult, type Row, type SearchHit } from './types';

const PREVIEW_MAX = 200;

/**
 * Pure-TS engine. Parses with the platform JSON.parse, then walks the value
 * tree *once* into a preorder, struct-of-arrays model. Collapse/expand and
 * row lookups go through a Fenwick tree so they stay O(log n) on millions of
 * nodes. Kept behind the Engine interface so a Rust/WASM engine can drop in.
 */
export class TsEngine implements Engine {
  private n = 0;
  private kind!: Uint8Array;
  private depth!: Uint32Array;
  private parent!: Int32Array;
  private childCount!: Uint32Array;
  private subtreeSize!: Uint32Array;
  private collapsed!: Uint8Array;
  /** Whether a node is currently rendered (no collapsed ancestor). */
  private visible!: Uint8Array;
  private keys!: (string | null)[];
  private keyIsIndex!: Uint8Array;
  private preview!: string[];
  /** Reference to the live JS sub-value, for copy/path. */
  private valueRef!: unknown[];
  private fen!: Fenwick;

  parse(text: string): ParseResult {
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = /position (\d+)/.exec(msg);
      return { ok: false, message: msg, position: m ? Number(m[1]) : undefined };
    }

    // Pass 1: count nodes (iterative, bounded stack).
    const count = countNodes(root);
    this.allocate(count);

    // Pass 2: flatten in preorder.
    this.flatten(root);

    // Everything starts expanded and visible.
    this.visible.fill(1);
    this.fen = new Fenwick(this.n);
    this.fen.initFrom(this.visible);

    return { ok: true, nodeCount: this.n, visibleCount: this.fen.count };
  }

  private allocate(n: number): void {
    this.n = n;
    this.kind = new Uint8Array(n);
    this.depth = new Uint32Array(n);
    this.parent = new Int32Array(n);
    this.childCount = new Uint32Array(n);
    this.subtreeSize = new Uint32Array(n);
    this.collapsed = new Uint8Array(n);
    this.visible = new Uint8Array(n);
    this.keyIsIndex = new Uint8Array(n);
    this.keys = new Array(n);
    this.preview = new Array(n);
    this.valueRef = new Array(n);
  }

  private flatten(root: unknown): void {
    let idx = 0;
    interface Frame {
      i: number;
      keys: string[] | null; // null => array, iterate by index
      arr: unknown[] | null;
      obj: Record<string, unknown> | null;
      cursor: number;
      len: number;
      depth: number;
    }
    const emit = (
      value: unknown,
      key: string | null,
      isIndex: boolean,
      depth: number,
      parent: number,
    ): number => {
      const i = idx++;
      this.parent[i] = parent;
      this.depth[i] = depth;
      this.keys[i] = key;
      this.keyIsIndex[i] = isIndex ? 1 : 0;
      this.valueRef[i] = value;
      const k = kindOf(value);
      this.kind[i] = k;
      this.preview[i] = isContainerKind(k) ? '' : previewPrimitive(value, k);
      return i;
    };

    const pushFrame = (value: unknown, i: number, depth: number, stack: Frame[]): void => {
      if (Array.isArray(value)) {
        this.childCount[i] = value.length;
        stack.push({ i, keys: null, arr: value, obj: null, cursor: 0, len: value.length, depth });
      } else {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);
        this.childCount[i] = keys.length;
        stack.push({ i, keys, arr: null, obj, cursor: 0, len: keys.length, depth });
      }
    };

    const rootIdx = emit(root, null, false, 0, -1);
    const stack: Frame[] = [];
    if (isContainer(root)) pushFrame(root, rootIdx, 0, stack);
    else this.subtreeSize[rootIdx] = 1;

    while (stack.length) {
      const f = stack[stack.length - 1]!;
      if (f.cursor < f.len) {
        const c = f.cursor++;
        let key: string | null;
        let isIndex: boolean;
        let val: unknown;
        if (f.keys) {
          key = f.keys[c]!;
          isIndex = false;
          val = f.obj![key];
        } else {
          key = String(c);
          isIndex = true;
          val = f.arr![c];
        }
        const j = emit(val, key, isIndex, f.depth + 1, f.i);
        if (isContainer(val)) pushFrame(val, j, f.depth + 1, stack);
        else this.subtreeSize[j] = 1;
      } else {
        this.subtreeSize[f.i] = idx - f.i;
        stack.pop();
      }
    }
  }

  // ---- read side -------------------------------------------------------

  visibleCount(): number {
    return this.fen.count;
  }

  getRows(start: number, count: number): Row[] {
    const out: Row[] = [];
    const total = this.fen.count;
    let id = this.fen.findKth(start);
    for (let r = 0; r < count && start + r < total && id !== -1; r++) {
      out.push(this.rowAt(id));
      id = this.nextVisible(id);
    }
    return out;
  }

  /** Next visible node after id, skipping collapsed subtrees. */
  private nextVisible(id: number): number {
    let j = this.collapsed[id] ? id + this.subtreeSize[id]! : id + 1;
    while (j < this.n && !this.visible[j]!) j++;
    return j < this.n ? j : -1;
  }

  private rowAt(id: number): Row {
    const k = this.kind[id]! as Kind;
    const cc = this.childCount[id]!;
    const isContainer = isContainerKind(k);
    return {
      id,
      depth: this.depth[id]!,
      kind: k,
      key: this.keys[id] ?? null,
      keyIsIndex: this.keyIsIndex[id] === 1,
      preview: this.preview[id]!,
      childCount: cc,
      collapsed: this.collapsed[id] === 1,
      expandable: isContainer && cc > 0,
    };
  }

  rowOf(id: number): number {
    if (id < 0 || id >= this.n || !this.visible[id]) return -1;
    return this.fen.prefix(id) - 1;
  }

  // ---- collapse / expand ----------------------------------------------

  toggle(id: number, collapse: boolean): number {
    if (isContainerKind(this.kind[id]!) && this.childCount[id]! > 0)
      this.setCollapsed(id, collapse);
    return this.fen.count;
  }

  /**
   * Collapse or expand one container, updating only the rows that actually
   * appear/disappear. Nested collapsed containers are skipped (their subtrees
   * are already hidden), so the cost is the number of rows toggled, not the
   * whole subtree.
   */
  private setCollapsed(i: number, collapse: boolean): void {
    if (!!this.collapsed[i] === collapse) return;
    this.collapsed[i] = collapse ? 1 : 0;
    const want = collapse ? 0 : 1;
    const delta = collapse ? -1 : 1;
    const end = i + this.subtreeSize[i]!;
    let j = i + 1;
    while (j < end) {
      if (this.visible[j] !== want) {
        this.visible[j] = want;
        this.fen.update(j, delta);
      }
      j = this.collapsed[j] ? j + this.subtreeSize[j]! : j + 1;
    }
  }

  toggleAll(collapse: boolean): number {
    // Fully collapsed = only the root row visible; fully expanded = all rows.
    for (let i = 0; i < this.n; i++) {
      const isC = isContainerKind(this.kind[i]!) && this.childCount[i]! > 0;
      this.collapsed[i] = collapse && isC ? 1 : 0;
      this.visible[i] = collapse ? (i === 0 ? 1 : 0) : 1;
    }
    this.fen.initFrom(this.visible);
    return this.fen.count;
  }

  collapseToDepth(d: number): number {
    for (let i = 0; i < this.n; i++) {
      const isC = isContainerKind(this.kind[i]!) && this.childCount[i]! > 0;
      this.collapsed[i] = isC && this.depth[i]! >= d ? 1 : 0;
      this.visible[i] = this.depth[i]! <= d ? 1 : 0;
    }
    this.fen.initFrom(this.visible);
    return this.fen.count;
  }

  reveal(id: number): number {
    // Expand every collapsed ancestor so the node becomes visible.
    const chain: number[] = [];
    let p = this.parent[id]!;
    while (p !== -1) {
      if (this.collapsed[p]) chain.push(p);
      p = this.parent[p]!;
    }
    // Expand from the top down.
    for (let c = chain.length - 1; c >= 0; c--) this.setCollapsed(chain[c]!, false);
    return this.rowOf(id);
  }

  // ---- search ----------------------------------------------------------

  search(query: string, valuesToo: boolean): SearchHit[] {
    const q = query.toLowerCase();
    if (!q) return [];
    const hits: SearchHit[] = [];
    for (let i = 0; i < this.n; i++) {
      const key = this.keys[i];
      if (key != null && this.keyIsIndex[i] === 0 && key.toLowerCase().includes(q)) {
        hits.push({ id: i, where: 'key' });
        continue;
      }
      if (valuesToo) {
        if (!isContainerKind(this.kind[i]!) && this.preview[i]!.toLowerCase().includes(q)) {
          hits.push({ id: i, where: 'value' });
        }
      }
    }
    return hits;
  }

  // ---- copy / path -----------------------------------------------------

  valueOf(id: number): unknown {
    return this.valueRef[id];
  }

  pathOf(id: number, flavor: 'js' | 'jsonpath'): string {
    const parts: { key: string; isIndex: boolean }[] = [];
    let cur = id;
    while (cur !== -1 && this.parent[cur] !== -1) {
      parts.push({ key: this.keys[cur]!, isIndex: this.keyIsIndex[cur] === 1 });
      cur = this.parent[cur]!;
    }
    parts.reverse();
    if (flavor === 'jsonpath') {
      let out = '$';
      for (const p of parts) {
        if (p.isIndex) out += `[${p.key}]`;
        else out += `['${p.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
      }
      return out;
    }
    let out = '';
    for (const p of parts) {
      if (p.isIndex) out += `[${p.key}]`;
      else if (isIdentifier(p.key)) out += `.${p.key}`;
      else out += `[${JSON.stringify(p.key)}]`;
    }
    return out.startsWith('.') ? out.slice(1) : out;
  }
}

// ---- helpers -----------------------------------------------------------

function isContainer(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

function isContainerKind(k: number): boolean {
  return k === Kind.Object || k === Kind.Array;
}

function kindOf(v: unknown): Kind {
  if (v === null) return Kind.Null;
  if (Array.isArray(v)) return Kind.Array;
  switch (typeof v) {
    case 'object':
      return Kind.Object;
    case 'string':
      return Kind.String;
    case 'number':
      return Kind.Number;
    case 'boolean':
      return Kind.Bool;
    default:
      return Kind.Null;
  }
}

function previewPrimitive(v: unknown, k: Kind): string {
  switch (k) {
    case Kind.String: {
      const s = v as string;
      const body = s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) + '…' : s;
      return JSON.stringify(body);
    }
    case Kind.Number:
      return String(v);
    case Kind.Bool:
      return v ? 'true' : 'false';
    default:
      return 'null';
  }
}

function isIdentifier(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
}

/** Iterative node count with O(depth) stack. */
function countNodes(root: unknown): number {
  let n = 0;
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    n++;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push(v[i]);
    } else if (isContainer(v)) {
      for (const key in v as Record<string, unknown>) {
        if (Object.prototype.hasOwnProperty.call(v, key))
          stack.push((v as Record<string, unknown>)[key]);
      }
    }
  }
  return n;
}

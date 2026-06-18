/**
 * Engine contract — the boundary between the data "engine" (parsing + indexed
 * model) and the UI. Designed so a Rust/WASM engine can replace the TS one
 * without the viewer noticing: the UI only ever asks for *rows by index* and
 * *opaque node ids*, never for materialized object trees.
 */

/**
 * Node kind, kept as small ints so a typed-array model maps 1:1. Modeled as a
 * const object (not a const enum) so it survives cross-module bundling and TS
 * type-stripping at runtime.
 */
export const Kind = {
  Object: 0,
  Array: 1,
  String: 2,
  Number: 3,
  Bool: 4,
  Null: 5,
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** A single rendered row — the only shape the UI consumes. */
export interface Row {
  /** Stable node id (index into the flat model). */
  id: number;
  /** Indentation level. */
  depth: number;
  kind: Kind;
  /** Object member key or array index label; null for the root. */
  key: string | null;
  /** True for array index labels (render differently from string keys). */
  keyIsIndex: boolean;
  /** Short, display-ready value text (already truncated for big strings). */
  preview: string;
  /** Container child count; 0 for primitives. */
  childCount: number;
  /** True if this container is collapsed. */
  collapsed: boolean;
  /** True if container has children (i.e. is expandable). */
  expandable: boolean;
}

export interface ParseOk {
  ok: true;
  /** Total node count in the document. */
  nodeCount: number;
  /** Visible (non-collapsed) row count right now. */
  visibleCount: number;
}

export interface ParseErr {
  ok: false;
  message: string;
  /** Character offset of the error, if known. */
  position?: number;
}

export type ParseResult = ParseOk | ParseErr;

export interface SearchHit {
  /** Node id of the match. */
  id: number;
  /** Whether the match was in the key or the value. */
  where: 'key' | 'value';
}

/**
 * The engine facade. All methods are synchronous *inside the worker*; the UI
 * talks to it over a message port (see worker/protocol.ts).
 */
export interface Engine {
  parse(text: string): ParseResult;

  /** Slice of visible rows [start, start+count) for the virtualized viewport. */
  getRows(start: number, count: number): Row[];

  /** Current visible row count (changes as nodes collapse/expand). */
  visibleCount(): number;

  /** Visible-row index of a node id, or -1 if hidden by a collapsed ancestor. */
  rowOf(id: number): number;

  /** Toggle one container; returns the new visible count. */
  toggle(id: number, collapsed: boolean): number;

  /** Expand or collapse the whole tree. */
  toggleAll(collapsed: boolean): number;

  /** Collapse/expand everything at or below a given depth. */
  collapseToDepth(depth: number): number;

  /** Substring search over keys+values; case-insensitive. Returns ordered hits. */
  search(query: string, valuesToo: boolean): SearchHit[];

  /** Ensure a node is visible by expanding its ancestors; returns its row index. */
  reveal(id: number): number;

  /** The materialized JS value of a node (for copy). */
  valueOf(id: number): unknown;

  /** Dotted/bracketed access path to a node, in JS or JSONPath flavor. */
  pathOf(id: number, flavor: 'js' | 'jsonpath'): string;
}

import type { ParseResult, Row, SearchHit } from '../engine/types';

/** Requests: UI → worker. Each carries a correlation id. */
export type Req =
  | { id: number; t: 'parse'; text: string }
  | { id: number; t: 'getRows'; start: number; count: number }
  | { id: number; t: 'toggle'; node: number; collapsed: boolean }
  | { id: number; t: 'toggleAll'; collapsed: boolean }
  | { id: number; t: 'collapseToDepth'; depth: number }
  | { id: number; t: 'search'; query: string; valuesToo: boolean }
  | { id: number; t: 'reveal'; node: number }
  | { id: number; t: 'copy'; node: number; what: 'value' | 'js' | 'jsonpath' };

/** Responses: worker → UI, keyed by the request id. */
export type Res =
  | { id: number; t: 'parse'; result: ParseResult }
  | { id: number; t: 'getRows'; rows: Row[] }
  | { id: number; t: 'count'; visible: number }
  | { id: number; t: 'search'; hits: SearchHit[] }
  | { id: number; t: 'reveal'; row: number; visible: number }
  | { id: number; t: 'copy'; text: string }
  | { id: number; t: 'error'; message: string };

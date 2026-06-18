/// <reference lib="webworker" />
import { TsEngine } from '../engine/ts-engine';
import type { Req, Res } from './protocol';

// One engine per worker / per document. Swap TsEngine for a WasmEngine here
// later — the message handling below is engine-agnostic.
const engine = new TsEngine();

function stringify(value: unknown): string {
  // Pretty for containers, bare for primitives.
  if (value !== null && typeof value === 'object') return JSON.stringify(value, null, 2);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

self.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data;
  const reply = (r: Res) => (self as DedicatedWorkerGlobalScope).postMessage(r);

  try {
    handle(msg, reply);
  } catch (err) {
    reply({ id: msg.id, t: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

function handle(msg: Req, reply: (r: Res) => void): void {
  switch (msg.t) {
    case 'parse':
      reply({ id: msg.id, t: 'parse', result: engine.parse(msg.text) });
      break;
    case 'getRows':
      reply({ id: msg.id, t: 'getRows', rows: engine.getRows(msg.start, msg.count) });
      break;
    case 'toggle':
      reply({ id: msg.id, t: 'count', visible: engine.toggle(msg.node, msg.collapsed) });
      break;
    case 'toggleAll':
      reply({ id: msg.id, t: 'count', visible: engine.toggleAll(msg.collapsed) });
      break;
    case 'collapseToDepth':
      reply({ id: msg.id, t: 'count', visible: engine.collapseToDepth(msg.depth) });
      break;
    case 'search':
      reply({ id: msg.id, t: 'search', hits: engine.search(msg.query, msg.valuesToo) });
      break;
    case 'reveal': {
      const row = engine.reveal(msg.node);
      reply({ id: msg.id, t: 'reveal', row, visible: engine.visibleCount() });
      break;
    }
    case 'copy': {
      let text: string;
      if (msg.what === 'value') text = stringify(engine.valueOf(msg.node));
      else text = engine.pathOf(msg.node, msg.what);
      reply({ id: msg.id, t: 'copy', text });
      break;
    }
  }
}

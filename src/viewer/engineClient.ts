import workerUrl from '../worker/engine.worker.ts?worker&url';
import type { ParseResult, Row, SearchHit } from '../engine/types';
import type { Req, Res } from '../worker/protocol';

/** Omit that distributes over the Req union so each variant keeps its fields. */
type ReqNoId = Req extends unknown ? Omit<Req, 'id'> : never;

/**
 * Promise-based client for the worker engine. Each request gets a correlation
 * id and resolves when its matching response arrives.
 */
export class EngineClient {
  private worker!: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (res: Res) => void; reject: (e: Error) => void }>();
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  /**
   * A cross-origin Worker script can't be loaded directly from a content script
   * (even a web-accessible chrome-extension:// URL is blocked). The worker bundle
   * is self-contained, so we fetch its code and run it from a same-origin Blob.
   */
  private async init(): Promise<void> {
    const url =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL(workerUrl)
        : workerUrl;
    const code = await (await fetch(url)).text();
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    this.worker = new Worker(blobUrl);
    this.worker.onmessage = (e: MessageEvent<Res>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.t === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    // A worker-level failure must not leave callers hanging forever.
    this.worker.onerror = (e) => {
      const err = new Error(`worker error: ${(e as ErrorEvent).message ?? 'unknown'}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  // R is inferred from the literal, so no excess-property check against the union.
  private send<R extends ReqNoId>(req: R): Promise<Res> {
    const id = ++this.seq;
    return new Promise<Res>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Wait for the worker to be constructed before posting.
      this.ready.then(() => this.worker.postMessage({ ...req, id } as unknown as Req), reject);
    });
  }

  async parse(text: string): Promise<ParseResult> {
    const r = await this.send({ t: 'parse', text });
    return (r as Extract<Res, { t: 'parse' }>).result;
  }
  async getRows(start: number, count: number): Promise<Row[]> {
    const r = await this.send({ t: 'getRows', start, count });
    return (r as Extract<Res, { t: 'getRows' }>).rows;
  }
  async toggle(node: number, collapsed: boolean): Promise<number> {
    const r = await this.send({ t: 'toggle', node, collapsed });
    return (r as Extract<Res, { t: 'count' }>).visible;
  }
  async toggleAll(collapsed: boolean): Promise<number> {
    const r = await this.send({ t: 'toggleAll', collapsed });
    return (r as Extract<Res, { t: 'count' }>).visible;
  }
  async collapseToDepth(depth: number): Promise<number> {
    const r = await this.send({ t: 'collapseToDepth', depth });
    return (r as Extract<Res, { t: 'count' }>).visible;
  }
  async search(query: string, valuesToo: boolean): Promise<SearchHit[]> {
    const r = await this.send({ t: 'search', query, valuesToo });
    return (r as Extract<Res, { t: 'search' }>).hits;
  }
  async reveal(node: number): Promise<{ row: number; visible: number }> {
    const r = (await this.send({ t: 'reveal', node })) as Extract<Res, { t: 'reveal' }>;
    return { row: r.row, visible: r.visible };
  }
  async copy(node: number, what: 'value' | 'js' | 'jsonpath'): Promise<string> {
    const r = await this.send({ t: 'copy', node, what });
    return (r as Extract<Res, { t: 'copy' }>).text;
  }
  async serialize(pretty: boolean): Promise<string> {
    const r = await this.send({ t: 'serialize', pretty });
    return (r as Extract<Res, { t: 'serialize' }>).text;
  }
}

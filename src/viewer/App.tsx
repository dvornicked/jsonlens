import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SearchHit } from '../engine/types';
import { EngineClient } from './engineClient';
import { VirtualTree } from './VirtualTree';

interface Props {
  /** Raw JSON document text. */
  text: string;
  /** Called when the text fails to parse, so the host can restore the page. */
  onParseError?: () => void;
}

type Status =
  | { phase: 'parsing' }
  | { phase: 'error'; message: string; position?: number }
  | { phase: 'ready'; nodeCount: number };

export function App({ text, onParseError }: Props) {
  const client = useMemo(() => new EngineClient(), []);
  const [status, setStatus] = useState<Status>({ phase: 'parsing' });
  const [visibleCount, setVisibleCount] = useState(0);

  const [query, setQuery] = useState('');
  const [valuesToo, setValuesToo] = useState(true);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hitIdx, setHitIdx] = useState(0);
  const [scrollToRow, setScrollToRow] = useState<number | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse once on mount.
  useEffect(() => {
    let alive = true;
    client.parse(text).then((res) => {
      if (!alive) return;
      if (res.ok) {
        setStatus({ phase: 'ready', nodeCount: res.nodeCount });
        setVisibleCount(res.visibleCount);
      } else {
        setStatus({ phase: 'error', message: res.message, position: res.position });
        onParseError?.();
      }
    });
    return () => {
      alive = false;
    };
  }, [client, text, onParseError]);

  // Debounced search.
  useEffect(() => {
    if (status.phase !== 'ready') return;
    const q = query.trim();
    const seq = ++searchSeq.current;
    if (!q) {
      setHits([]);
      return;
    }
    const h = setTimeout(() => {
      client.search(q, valuesToo).then((res) => {
        if (seq !== searchSeq.current) return;
        setHits(res);
        setHitIdx(0);
        if (res.length) gotoHit(res, 0);
      });
    }, 160);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, valuesToo, status.phase]);

  const matches = useMemo(() => new Set(hits.map((h) => h.id)), [hits]);
  const activeHit = hits[hitIdx]?.id ?? null;

  function gotoHit(list: SearchHit[], idx: number) {
    const hit = list[idx];
    if (!hit) return;
    // reveal expands collapsed ancestors, which can grow the visible count.
    client.reveal(hit.id).then(({ row, visible }) => {
      setVisibleCount(visible);
      setScrollToRow(row);
      setScrollTick((t) => t + 1);
    });
  }

  function stepHit(delta: number) {
    if (!hits.length) return;
    const next = (hitIdx + delta + hits.length) % hits.length;
    setHitIdx(next);
    gotoHit(hits, next);
  }

  async function onToggle(node: number, collapsed: boolean) {
    const vc = await client.toggle(node, collapsed);
    setVisibleCount(vc);
  }

  async function onToggleAll(collapsed: boolean) {
    const vc = await client.toggleAll(collapsed);
    setVisibleCount(vc);
    setScrollToRow(0);
    setScrollTick((t) => t + 1);
  }

  async function onCopy(node: number, what: 'value' | 'js' | 'jsonpath') {
    const text = await client.copy(node, what);
    try {
      await navigator.clipboard.writeText(text);
      showToast(what === 'value' ? 'Value copied' : `Path copied: ${truncate(text, 60)}`);
    } catch {
      showToast('Copy failed (clipboard blocked)');
    }
  }

  // Re-serialize off-thread (the worker holds the parsed value) and save it as a
  // pretty-printed .json file.
  async function downloadPretty() {
    try {
      // Re-serialize can take a beat on tens of MB — acknowledge the click.
      showToast('Preparing export…');
      const content = await client.serialize(true);
      const name = downloadName();
      triggerDownload(content, name);
      showToast(`Downloaded ${name}`);
    } catch {
      showToast('Export failed');
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  if (status.phase === 'parsing') {
    return <div class="jl-center">Parsing {fmtBytes(text.length)} of JSON…</div>;
  }
  if (status.phase === 'error') {
    return (
      <div class="jl-center jl-error">
        <strong>Invalid JSON</strong>
        <div>{status.message}</div>
      </div>
    );
  }

  return (
    <div class="jl-app">
      <header class="jl-toolbar">
        <span class="jl-brand">JSONLens</span>

        <div class="jl-search">
          <input
            placeholder="Search keys & values…"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepHit(e.shiftKey ? -1 : 1);
            }}
          />
          <label class="jl-chk" title="Also search values">
            <input
              type="checkbox"
              checked={valuesToo}
              onChange={(e) => setValuesToo((e.target as HTMLInputElement).checked)}
            />
            values
          </label>
          {query && (
            <span class="jl-count">{hits.length ? `${hitIdx + 1}/${hits.length}` : '0/0'}</span>
          )}
          <button
            disabled={!hits.length}
            onClick={() => stepHit(-1)}
            title="Previous (Shift+Enter)"
          >
            ↑
          </button>
          <button disabled={!hits.length} onClick={() => stepHit(1)} title="Next (Enter)">
            ↓
          </button>
        </div>

        <div class="jl-spacer-flex" />

        <button onClick={() => onToggleAll(false)}>Expand all</button>
        <button onClick={() => onToggleAll(true)}>Collapse all</button>

        <button onClick={downloadPretty}>Download</button>

        <span class="jl-stat">{status.nodeCount.toLocaleString()} nodes</span>
      </header>

      <VirtualTree
        client={client}
        visibleCount={visibleCount}
        scrollToRow={scrollToRow}
        scrollTick={scrollTick}
        activeHit={activeHit}
        matches={matches}
        onToggle={onToggle}
        onCopy={onCopy}
      />

      {toast && <div class="jl-toast">{toast}</div>}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Download filename derived from the document URL, e.g. `/foo/data.json` → `data.json`. */
function downloadName(): string {
  const seg = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const base = seg.replace(/\.json$/i, '') || 'document';
  return `${base}.json`;
}

/** Save a string as a file via a transient blob URL + `<a download>`. */
function triggerDownload(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Keep the URL alive until the download has certainly started, then free it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Kind, type Row } from '../engine/types';
import type { EngineClient } from './engineClient';
import { OVERSCAN, ROW_H } from './constants';

interface Props {
  client: EngineClient;
  /** Total visible rows; drives the scroll height. */
  visibleCount: number;
  /** Row index to scroll to (after reveal), or null. */
  scrollToRow: number | null;
  /** Bumped every time a scroll-to is requested, even to the same row. */
  scrollTick: number;
  /** Currently highlighted search-hit node id. */
  activeHit: number | null;
  /** Set of node ids that matched the search (for highlight). */
  matches: Set<number>;
  onToggle: (node: number, collapsed: boolean) => void;
  onCopy: (node: number, what: 'value' | 'js' | 'jsonpath') => void;
}

const KIND_CLASS: Record<Kind, string> = {
  [Kind.Object]: 'k-obj',
  [Kind.Array]: 'k-arr',
  [Kind.String]: 'k-str',
  [Kind.Number]: 'k-num',
  [Kind.Bool]: 'k-bool',
  [Kind.Null]: 'k-null',
};

export function VirtualTree(props: Props) {
  const { client, visibleCount, scrollToRow, scrollTick } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<{ start: number; rows: Row[] }>({ start: 0, rows: [] });
  const reqToken = useRef(0);

  // Fetch the window of rows for a given scrollTop.
  const fetchWindow = (scrollTop: number, height: number) => {
    // Clamp first into range — after a collapse the model can shrink below the
    // current scrollTop, which would otherwise yield a negative count.
    const first = Math.min(
      Math.max(0, visibleCount - 1),
      Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN),
    );
    const visible = Math.ceil(height / ROW_H) + OVERSCAN * 2;
    const count = Math.max(0, Math.min(visible, visibleCount - first));
    const token = ++reqToken.current;
    client.getRows(first, count).then((rows) => {
      if (token === reqToken.current) setRange({ start: first, rows });
    });
  };

  // Refetch when the model changes (collapse/expand/parse).
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) fetchWindow(el.scrollTop, el.clientHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCount]);

  // Scroll to a revealed row.
  useLayoutEffect(() => {
    if (scrollToRow == null) return;
    const el = scrollerRef.current;
    if (!el) return;
    const target = scrollToRow * ROW_H;
    // Center it if off-screen.
    if (target < el.scrollTop || target > el.scrollTop + el.clientHeight - ROW_H) {
      el.scrollTop = Math.max(0, target - el.clientHeight / 2);
    }
    fetchWindow(el.scrollTop, el.clientHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTick]);

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLDivElement;
    fetchWindow(el.scrollTop, el.clientHeight);
  };

  return (
    <div class="jl-scroller" ref={scrollerRef} onScroll={onScroll}>
      <div class="jl-spacer" style={{ height: visibleCount * ROW_H }}>
        {range.rows.map((row, i) => (
          <RowView
            key={row.id}
            row={row}
            top={(range.start + i) * ROW_H}
            active={props.activeHit === row.id}
            matched={props.matches.has(row.id)}
            onToggle={props.onToggle}
            onCopy={props.onCopy}
          />
        ))}
      </div>
    </div>
  );
}

function RowView(props: {
  row: Row;
  top: number;
  active: boolean;
  matched: boolean;
  onToggle: (node: number, collapsed: boolean) => void;
  onCopy: (node: number, what: 'value' | 'js' | 'jsonpath') => void;
}) {
  const { row } = props;
  const cls = ['jl-row', props.active && 'is-active', props.matched && 'is-match']
    .filter(Boolean)
    .join(' ');
  return (
    <div class={cls} style={{ top: props.top, height: ROW_H, paddingLeft: 8 + row.depth * 14 }}>
      {row.expandable ? (
        <button
          class="jl-twisty"
          aria-label={row.collapsed ? 'Expand' : 'Collapse'}
          onClick={() => props.onToggle(row.id, !row.collapsed)}
        >
          {row.collapsed ? '▸' : '▾'}
        </button>
      ) : (
        <span class="jl-twisty jl-twisty--leaf" />
      )}

      {row.key !== null && (
        <span class={row.keyIsIndex ? 'jl-key jl-key--idx' : 'jl-key'}>
          {row.keyIsIndex ? row.key : `"${row.key}"`}
          <span class="jl-colon">:</span>
        </span>
      )}

      <span class={`jl-val ${KIND_CLASS[row.kind]}`}>{summarize(row)}</span>

      <span class="jl-actions">
        <button title="Copy value" onClick={() => props.onCopy(row.id, 'value')}>
          ⧉
        </button>
        <button title="Copy JS path" onClick={() => props.onCopy(row.id, 'js')}>
          path
        </button>
        <button title="Copy JSONPath" onClick={() => props.onCopy(row.id, 'jsonpath')}>
          $
        </button>
      </span>
    </div>
  );
}

function summarize(row: Row): string {
  if (row.kind === Kind.Object) {
    return row.collapsed ? `{ ${row.childCount} } ` : '{';
  }
  if (row.kind === Kind.Array) {
    return row.collapsed ? `[ ${row.childCount} ]` : '[';
  }
  return row.preview;
}

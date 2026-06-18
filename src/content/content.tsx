import { render } from 'preact';
import { App } from '../viewer/App';
import css from '../viewer/styles.css?inline';

/** Content types we treat as JSON, including the `+json` structured-suffix family. */
function isJsonContentType(ct: string): boolean {
  return (
    ct === 'application/json' || ct === 'text/json' || ct.endsWith('+json') // application/ld+json, vnd.api+json, problem+json, manifest+json…
  );
}

/**
 * Decide whether this document is a raw JSON payload we should take over, and
 * return its text. We avoid serializing `body.textContent` for ordinary HTML
 * pages: only the cheap shape checks (contentType, lone-<pre>) run first.
 */
function detectJson(): string | null {
  const body = document.body;
  if (!body) return null;

  const byType = isJsonContentType(document.contentType);

  const onlyPre =
    body.childElementCount === 1 && body.firstElementChild?.tagName === 'PRE'
      ? (body.firstElementChild as HTMLElement)
      : null;

  // Bail before touching textContent unless the page even could be raw JSON.
  if (!byType && !onlyPre) return null;

  const text = (onlyPre ? onlyPre.textContent : body.textContent) ?? '';
  const trimmed = text.trim();
  if (!trimmed) return null;

  const structural =
    (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') ||
    (trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']');

  // Trust an explicit JSON content type; otherwise require the lone-<pre>
  // structural shape so we don't hijack arbitrary text/plain pages.
  if (byType || (onlyPre && structural)) return text;
  return null;
}

function mount(text: string): void {
  // Keep the original document so we can restore it if the payload turns out
  // not to be valid JSON (detection is a cheap shape check, not a full parse).
  const original = Array.from(document.documentElement.childNodes);
  document.documentElement.replaceChildren();

  const head = document.createElement('head');
  const style = document.createElement('style');
  style.textContent = css;
  head.appendChild(style);

  const bodyEl = document.createElement('body');
  const root = document.createElement('div');
  root.id = 'jsonlens-root';
  bodyEl.appendChild(root);

  document.documentElement.append(head, bodyEl);
  const base =
    document.title || location.pathname.split('/').filter(Boolean).pop() || location.host;
  document.title = 'JSONLens — ' + base;

  const restore = () => {
    document.documentElement.replaceChildren(...original);
  };

  render(<App text={text} onParseError={restore} />, root);
}

const json = detectJson();
if (json !== null) mount(json);

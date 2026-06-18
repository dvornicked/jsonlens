import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(__dirname, '..', 'dist');

const SAMPLE = {
  user: { name: 'Ann', age: 30, tags: ['alpha', 'beta', 'gamma'] },
  active: true,
  meta: null,
  items: [{ id: 1 }, { id: 2 }],
};

let context: BrowserContext;

test.beforeAll(async () => {
  // headless:false selects the full chromium binary (not headless_shell, which
  // can't load extensions); `--headless=new` then runs it windowless — the new
  // headless mode that does support MV3 extensions.
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
});

test.afterAll(async () => {
  await context?.close();
});

/** Open a fake URL whose response is served as application/json so the content
 *  script treats it as a raw JSON document. */
async function openJson(body: unknown): Promise<Page> {
  const page = await context.newPage();
  await page.route('**/data.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
  await page.goto('https://jsonlens.test/data.json');
  await page.waitForSelector('#jsonlens-root .jl-app', { timeout: 15_000 });
  return page;
}

test('renders the viewer over a JSON document', async () => {
  const page = await openJson(SAMPLE);
  await expect(page.locator('.jl-brand')).toHaveText('JSONLens');
  await expect(page.locator('.jl-stat')).toContainText('nodes');
  // The first key of the document is visible in the tree.
  await expect(page.locator('.jl-key', { hasText: 'user' }).first()).toBeVisible();
  await page.close();
});

test('search highlights matches and reports a count', async () => {
  const page = await openJson(SAMPLE);
  await page.fill('.jl-search input', 'tags');
  await expect(page.locator('.jl-count')).toHaveText('1/1');
  await expect(page.locator('.jl-row.is-active')).toBeVisible();
  await page.close();
});

test('collapse all then expand all changes the visible row count', async () => {
  const page = await openJson(SAMPLE);
  const rowCount = () => page.locator('.jl-row').count();
  // Wait for the virtualized rows to be fetched and rendered before measuring.
  await expect.poll(rowCount).toBeGreaterThan(1);
  const expanded = await rowCount();
  await page.click('button:has-text("Collapse all")');
  await expect.poll(rowCount).toBe(1); // only the root row remains
  await page.click('button:has-text("Expand all")');
  await expect.poll(rowCount).toBe(expanded);
  await page.close();
});

test('copy JS path writes the path to the clipboard', async () => {
  const page = await openJson(SAMPLE);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://jsonlens.test',
  });
  // Hover the "tags" row to reveal the action buttons, then copy its JS path.
  const tagsRow = page.locator('.jl-row', { has: page.locator('.jl-key', { hasText: 'tags' }) });
  await tagsRow.hover();
  await tagsRow.locator('button[title="Copy JS path"]').click();
  await expect(page.locator('.jl-toast')).toContainText('user.tags');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('user.tags');
  await page.close();
});

test('switches to raw mode and back', async () => {
  const page = await openJson(SAMPLE);
  await page.click('.jl-modes button:has-text("Raw")');
  await expect(page.locator('pre.jl-raw')).toContainText('"alpha"');
  await page.click('.jl-modes button:has-text("Tree")');
  await expect(page.locator('.jl-scroller')).toBeVisible();
  await page.close();
});

test('restores the original page for invalid JSON', async () => {
  const page = await context.newPage();
  // Looks structural ({...}) but is not valid JSON → content script must restore.
  await page.route('**/bad.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: '{ "a": 1, oops }' }),
  );
  await page.goto('https://jsonlens.test/bad.json');
  // The viewer must not take over; no app root should remain.
  await expect(page.locator('#jsonlens-root .jl-app')).toHaveCount(0);
  await page.close();
});

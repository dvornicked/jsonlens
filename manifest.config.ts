import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'JSONLens',
  version: '0.1.0',
  description: 'Fast, virtualized JSON viewer for huge payloads — search, copy paths, export.',
  // Detect & take over raw JSON documents. We match all URLs and bail out
  // inside the content script unless the page is actually a JSON document.
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content.tsx'],
      run_at: 'document_end',
      all_frames: false,
    },
  ],
  // Workers, the viewer HTML and styles are loaded by the content script,
  // so they must be web-accessible.
  web_accessible_resources: [
    {
      resources: ['src/worker/engine.worker.ts', 'assets/*'],
      matches: ['<all_urls>'],
    },
  ],
  permissions: ['clipboardWrite', 'storage'],
  icons: {
    '16': 'public/icons/icon16.png',
    '48': 'public/icons/icon48.png',
    '128': 'public/icons/icon128.png',
  },
});

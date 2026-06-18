import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  build: {
    target: 'es2022',
    // Keep chunks predictable for an extension build.
    rollupOptions: {
      output: { chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
  worker: {
    format: 'es',
  },
});

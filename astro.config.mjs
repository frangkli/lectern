// @ts-check
import { defineConfig, envField, fontProviders } from 'astro/config';

import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  // Docs are read from disk on every request, so every page renders on demand.
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  session: false,
  // Links to other pages prerender while the pointer rests on them, so a click shows a finished page.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  experimental: { clientPrerender: true },
  // The kit names these faces; Astro downloads them at build time and serves them itself. Every subset
  // is listed, so file trees' box-drawing characters and non-Latin text keep the face; a browser only
  // fetches the subsets a page uses.
  fonts: [
    { name: 'Hanken Grotesk', cssVariable: '--font-hanken', provider: fontProviders.google(), weights: ['100 900'], styles: ['normal', 'italic'], subsets: ['latin', 'latin-ext', 'cyrillic-ext', 'vietnamese'] },
    { name: 'Geist Mono', cssVariable: '--font-geist-mono', provider: fontProviders.google(), weights: ['400 600'], subsets: ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext', 'vietnamese', 'symbols2'], fallbacks: ['monospace'] },
  ],
  // Read when the server starts, not baked into the build. Astro reads only "secret" variables at run time,
  // so these folder paths use that access even though they aren't secret.
  env: {
    schema: {
      // Folders holding your clones, separated by ":". Default: ~/workspace.
      LECTERN_ROOTS: envField.string({ context: 'server', access: 'secret', optional: true }),
      // The notes folder. Default: ~/workspace/notes.
      LECTERN_NOTES: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});

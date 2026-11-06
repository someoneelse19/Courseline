import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { contentSecurityPolicy } from './src/lib/csp';
import { readSystemClock } from './src/lib/systemClockServer';
import edition from './edition.json';

// What PDF.js loads by itself to draw some PDFs fully: the WebAssembly image decoders (JBIG2, the compression scanners
// use, and JPEG 2000; without them those images are left out), the 14 standard fonts (for PDFs that do not embed them),
// the character maps (Chinese, Japanese, Korean text) and its color profile. Served at /pdfjs/<dir>/ by the dev server
// and copied there in a build; components/FileViewer.tsx points PDF.js at them (PDFJS_ASSETS).
const PDFJS_DIRS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];
const PDFJS_ROOT = join(process.cwd(), 'node_modules', 'pdfjs-dist');
const PDFJS_TYPES: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript' };
function pdfjsAssets(): Plugin {
  // Not the licenses, nor quickjs (PDF.js's engine for scripts inside PDFs, which Courseline never turns on).
  const files = () =>
    PDFJS_DIRS.flatMap((dir) => readdirSync(join(PDFJS_ROOT, dir)).filter((f) => statSync(join(PDFJS_ROOT, dir, f)).isFile() && !f.startsWith('LICENSE') && !f.startsWith('quickjs')).map((f) => `${dir}/${f}`));
  return {
    name: 'courseline-pdfjs-assets',
    configureServer(server) {
      const known = new Set(files());
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        if (!known.has(path)) return next();
        res.setHeader('Content-Type', PDFJS_TYPES[extname(path)] ?? 'application/octet-stream');
        res.end(readFileSync(join(PDFJS_ROOT, path)));
      });
    },
    generateBundle() {
      for (const path of files()) this.emitFile({ type: 'asset', fileName: `pdfjs/${path}`, source: readFileSync(join(PDFJS_ROOT, path)) });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix reads all vars from .env files (not just VITE_*).
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_CANVAS_BASE_URL;
  // The API-token edition (what the main branch ships, with edition.json saying `"apiOnly": true`; or any build with
  // COURSELINE_EDITION=api): token sign-in only, and the app never looks for or talks to the browser extension.
  // Tests always run the full app, so every feature stays tested on both branches.
  const apiOnly = mode !== 'test' && (edition.apiOnly || env.COURSELINE_EDITION === 'api');

  // Optional dev proxy. Canvas normally sends CORS headers for API requests that
  // carry a Bearer token, but some institutions lock this down. If you see
  // "Network error ... CORS" in the app, set VITE_USE_DEV_PROXY=true and the
  // browser will talk to this dev server (same origin) which forwards to Canvas.
  // Dev-only: it does nothing in a production build.
  const proxy =
    env.VITE_USE_DEV_PROXY === 'true' && target
      ? {
          '/canvas-proxy': {
            target,
            changeOrigin: true,
            secure: true,
            // Canvas answers file downloads with a redirect to its file storage (another host).
            // Following it here keeps the bytes same-origin for the browser, so no CORS is involved.
            followRedirects: true,
            rewrite: (path: string) => path.replace(/^\/canvas-proxy/, ''),
          },
        }
      : undefined;

  return {
    plugins: [
      react(),
      tailwindcss(),
      pdfjsAssets(),
      {
        // The policy goes in as the first thing in <head> so it covers everything after it.
        name: 'courseline-csp',
        transformIndexHtml: {
          order: 'pre',
          handler: (html, ctx) =>
            html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(!!ctx.server)}" />`),
        },
      },
      {
        // The computer's 12/24-hour clock and first weekday, which the browser can't see (see src/lib/systemClock.ts).
        name: 'courseline-system-clock',
        transformIndexHtml: async (html, ctx) => {
          if (!ctx.server) return html;
          const clock = JSON.stringify(await readSystemClock()).replace(/"/g, '&quot;');
          return html.replace('</head>', `  <meta name="courseline-clock" content="${clock}" />\n  </head>`);
        },
      },
      {
        // Without this tag the extension's bridge script ignores the page (extension/bridge.js).
        name: 'courseline-edition',
        transformIndexHtml: (html) => (apiOnly ? html.replace(/\s*<!--[^>]*extension[^>]*-->\s*<meta name="courseline-app" content="1" \/>/, '') : html),
      },
    ],
    define: { __API_ONLY__: JSON.stringify(apiOnly) },
    server: { proxy },
    // The app itself is ~100 KB (gzipped). The big chunks are the document viewers (PDF.js, PowerPoint, Excel,
    // Word), which are imported on demand the first time a file of that type is opened, so the default
    // 500 KB warning does not apply to them.
    build: { chunkSizeWarningLimit: 1400 },
    // `npm test`: unit + component tests run in a simulated browser (jsdom), with fetch faked per test.
    test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}', 'extension/**/*.test.js'] },
  };
});

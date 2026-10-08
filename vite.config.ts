import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // loadEnv with '' prefix reads all vars from .env files (not just VITE_*).
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_CANVAS_BASE_URL;

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
    plugins: [react(), tailwindcss()],
    server: { proxy },
    // The app itself is ~100 KB (gzipped). The big chunks are the document viewers (PDF.js, PowerPoint, Excel,
    // Word), which are imported on demand the first time a file of that type is opened, so the default
    // 500 KB warning does not apply to them.
    build: { chunkSizeWarningLimit: 1400 },
    // `npm test`: unit + component tests run in a simulated browser (jsdom), with fetch faked per test.
    test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
  };
});

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CANVAS_BASE_URL?: string;
  readonly VITE_CANVAS_API_TOKEN?: string;
  readonly VITE_USE_DEV_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The legacy PDF.js build has the same API (and types) as the main one but ships no typings of its own.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown;
}

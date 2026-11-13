// The Courseline connector's entry point: a Model Context Protocol server the Claude desktop app runs on this
// computer (bundled by connector/build.mjs). It reads Canvas with the student's own access token, which the app
// keeps in the system keychain and passes in as CANVAS_TOKEN. Nothing but protocol messages may go to stdout.

import { JSDOM } from 'jsdom';
import { createCanvasApi } from '../api/canvas';
import { extractText } from '../lib/extractText';
import { createHandler, SERVER_INFO } from './protocol';
import { makeCache, tools } from './tools';

// Libraries (PDF.js above all) print warnings with console.log; on stdout they would break the protocol.
console.log = console.info = console.warn = console.debug = (...args: unknown[]) => console.error(...args);

// The shared code parses HTML and Office XML with the browser's DOMParser.
(globalThis as { DOMParser?: unknown }).DOMParser = new JSDOM('').window.DOMParser;
// PDF.js reads PDFs on this thread when its worker module is already loaded (no worker file to find).
(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');

const baseUrl = process.env.CANVAS_BASE_URL?.trim() ?? '';
const token = process.env.CANVAS_TOKEN?.trim() ?? '';
if (!baseUrl || !token) {
  console.error('Courseline connector: set your Canvas address and access token in the connector settings (Claude → Settings → Extensions).');
}

const api = createCanvasApi({ baseUrl: baseUrl || 'https://canvas.invalid', token });
const handle = createHandler(tools, { api, readText: extractText, cache: makeCache() });
console.error(`${SERVER_INFO.name} ${SERVER_INFO.version} ready (${baseUrl || 'no Canvas address set'})`);

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

function onLine(line: string) {
  if (!line.trim()) return;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // Calls run side by side; each answer goes out when it is ready (they carry their request's id).
  handle(message)
    .then((response) => response && send(response))
    .catch((err) => console.error('Courseline connector:', err));
}

// Plain 'data' events, split into lines here. The Claude app's built-in Node replaces process.stdin with a stand-in
// that has only the basic stream methods (on, once, pause, resume, setEncoding…), so nothing fancier (readline,
// async iteration) is relied on.
let pending = '';
const decoder = new TextDecoder();
process.stdin.on('data', (chunk: string | Uint8Array) => {
  pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  let newline: number;
  while ((newline = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newline).replace(/\r$/, '');
    pending = pending.slice(newline + 1);
    onLine(line);
  }
});
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();

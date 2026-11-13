// Builds the Courseline connector for the Claude desktop app: bundles src/connector/main.ts and everything it uses
// into one file, then packs it with manifest.json into courseline-canvas.mcpb (a zip the app installs).
//
//   node connector/build.mjs
//
// Output: connector/server/index.mjs, so connector/ itself is a working unpacked extension (its manifest.json points
// there), and connector/courseline-canvas.mcpb, the same two files zipped. Either can be installed in the Claude app.

import { build } from 'esbuild';
import JSZip from 'jszip';
import { readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const serverFile = join(here, 'server/index.mjs');

// Browser-only bits of the shared code, swapped for what works in Node.
const nodeStubs = {
  name: 'node-stubs',
  setup(b) {
    // A Vite "?url" import (the PDF.js worker's address): the connector loads the worker in-process instead.
    b.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: 'stub-url' }));
    b.onLoad({ filter: /.*/, namespace: 'stub-url' }, () => ({ contents: 'export default "";', loader: 'js' }));
    // Where the web app serves PDF.js's fonts and decoders: not needed to read a PDF's text.
    b.onResolve({ filter: /\/pdfjsAssets$/ }, () => ({ path: 'pdfjsAssets', namespace: 'stub-assets' }));
    b.onLoad({ filter: /.*/, namespace: 'stub-assets' }, () => ({ contents: 'export function pdfjsAssets() { return {}; }', loader: 'js' }));
  },
};

// jsdom finds two files next to its own sources at runtime, which a one-file bundle has no folder for: its default
// stylesheet (inlined here) and the worker for synchronous XMLHttpRequest (never used by the connector).
const jsdomFiles = {
  name: 'jsdom-files',
  setup(b) {
    b.onLoad({ filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]helpers[\\/]style-rules\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const css = await readFile(join(dirname(args.path), '../../browser/default-stylesheet.css'), 'utf8');
      const patched = source.replace(/fs\.readFileSync\(\s*path\.resolve\(__dirname, "\.\.\/\.\.\/browser\/default-stylesheet\.css"\),\s*\{ encoding: "utf-8" \}\s*\)/, JSON.stringify(css));
      if (patched === source) throw new Error('jsdom changed: the default stylesheet is no longer read the expected way (connector/build.mjs)');
      return { contents: patched, loader: 'js' };
    });
    b.onLoad({ filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]xhr[\\/]XMLHttpRequest-impl\.js$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const patched = source.replace('require.resolve ? require.resolve("./xhr-sync-worker.js") : null', 'null');
      if (patched === source) throw new Error('jsdom changed: the XMLHttpRequest worker is no longer found the expected way (connector/build.mjs)');
      return { contents: patched, loader: 'js' };
    });
  },
};

await rm(join(here, 'dist'), { recursive: true, force: true }); // where older builds put it
await rm(join(here, 'server'), { recursive: true, force: true });
await mkdir(join(here, 'server'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/connector/main.ts')],
  outfile: serverFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: !process.env.DEBUG,
  legalComments: 'none',
  logLevel: 'warning',
  // CommonJS packages in an ES module bundle still call require() for Node's own modules.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { 'import.meta.env': '{"BASE_URL":"/","MODE":"production","DEV":false,"PROD":true}' },
  // Optional native add-ons that jsdom and PDF.js try to load and do without.
  external: ['canvas', '@napi-rs/canvas', 'bufferutil', 'utf-8-validate'],
  plugins: [nodeStubs, jsdomFiles],
});

const manifest = JSON.parse(await readFile(join(here, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (join(here, manifest.server.entry_point) !== serverFile) throw new Error(`manifest.json's entry_point (${manifest.server.entry_point}) is not where the build puts the server`);

const zip = new JSZip();
zip.file('manifest.json', await readFile(join(here, 'manifest.json')));
zip.file('server/index.mjs', await readFile(serverFile));
try {
  zip.file('icon.png', await readFile(join(here, 'icon.png')));
} catch {
  /* no icon */
}
const out = join(here, 'courseline-canvas.mcpb');
await writeFile(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
const size = (await stat(out)).size;
console.log(`Built ${out} (${(size / 1024 / 1024).toFixed(1)} MB), version ${manifest.version} for Courseline ${pkg.version}`);

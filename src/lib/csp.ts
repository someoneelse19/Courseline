// The Content-Security-Policy put into index.html by vite.config.ts. Lives here so it can be tested.
//
// What it does: blocks plugins (object-src), re-pointing the page's base URL, forms posting elsewhere, and any
// script that is not from this site or the one CDN Monaco loads from.
// What it cannot do, and why:
//   - 'unsafe-inline' scripts: index.html has an inline first-paint script (and Vite's dev client injects one), so an
//     injected inline script is NOT blocked.
//   - connect-src https:: the Canvas address is typed in by the user, so any https host has to be reachable; this
//     does not stop a script from sending data to an https site.
// Closing those two needs a backend (see the security model in DEVELOPER_GUIDE.md).
/**
 * Video players instructors embed in Canvas pages, and the player addresses on each. An iframe is kept in Canvas HTML
 * only when it is one of these (components/HtmlContent.tsx), and frames may load only from these hosts.
 */
export const VIDEO_EMBEDS: Record<string, RegExp> = {
  'https://player.vimeo.com': /^\/video\/\d+\/?$/,
  'https://www.youtube.com': /^\/embed\/[\w-]+\/?$/,
  'https://www.youtube-nocookie.com': /^\/embed\/[\w-]+\/?$/,
};

export function contentSecurityPolicy(dev: boolean): string {
  const connect = ["'self'", 'https:', 'blob:', 'data:', ...(dev ? ['ws://localhost:*', 'ws://127.0.0.1:*', 'http://localhost:*'] : [])];
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval': PDF.js decodes some image formats with WebAssembly. No 'unsafe-eval'.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    // blob:: the fonts a Word document embeds, which the viewer (docx-preview) loads from blob: addresses.
    "font-src 'self' data: blob: https://cdn.jsdelivr.net",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self' blob:",
    `frame-src 'self' ${Object.keys(VIDEO_EMBEDS).join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

import { useMemo, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { useAuth } from '../context/AuthContext';
import { useFileViewer } from '../context/FileViewerContext';
import { EMBEDS, type Embed } from '../lib/csp';
import { fileLinkName } from '../lib/html';
import { t } from '../i18n';

// Canvas gives us HTML written by instructors (assignment descriptions, submission
// bodies). We render it, but ONLY after DOMPurify strips scripts, event handlers,
// iframes, javascript: URLs, etc. This matters: our Canvas token sits in localStorage,
// so an XSS here would leak it. Don't bypass this component with dangerouslySetInnerHTML.
// The iframes kept are embeds from known hosts (EMBEDS in lib/csp.ts, which also limits frame-src to them): a
// cross-origin frame cannot read this page or its storage, and it is sandboxed besides. Any other embed becomes a link
// to it, so the student still sees that something is there and can open it.

/** Which kind of allowed embed this iframe address is (https, a known host and path), or null if it is not one. */
export function embedKind(src: string | null): Embed['kind'] | null {
  if (!src) return null;
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    const embed = EMBEDS[u.origin];
    return embed?.path.test(u.pathname) ? embed.kind : null;
  } catch {
    return null;
  }
}

/**
 * Before sanitizing: an embedded page from a known host gets an "open in a new tab" link under it (in case it refuses
 * to load inside another site), and any other web embed is replaced by a link to it. Parsed into an inert document: no
 * script runs and nothing loads.
 */
function rewriteFrames(html: string, absolute: (value: string) => string): string {
  if (!/<iframe/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const frame of doc.querySelectorAll('iframe')) {
    const kind = embedKind(frame.getAttribute('src'));
    if (kind === 'video') continue;
    const href = absolute(frame.getAttribute('src') ?? '');
    let host: string;
    try {
      const u = new URL(href);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
      host = u.host;
    } catch {
      continue; // no web address (srcdoc, javascript:…): the sanitizer removes it
    }
    const link = doc.createElement('a');
    link.setAttribute('href', href);
    if (kind === 'page') {
      link.className = 'canvas-embed-open';
      link.textContent = t('Open in a new tab');
      frame.after(link);
    } else {
      link.className = 'canvas-embed';
      link.textContent = frame.getAttribute('title')?.trim() || t('Embedded content from {host}', { host });
      frame.replaceWith(link);
    }
  }
  return doc.body.innerHTML;
}
export function isCanvasFileLink(href: string, baseUrl: string | null): boolean {
  if (!baseUrl) return false;
  try {
    const u = new URL(href, baseUrl);
    return u.origin === new URL(baseUrl).origin && /\/files\/\d+/.test(u.pathname);
  } catch {
    return false;
  }
}

export function sanitize(html: string, baseUrl: string | null): string {
  const absolute = (value: string) => {
    if (!baseUrl) return value;
    try {
      // Canvas content often uses root-relative links ("/courses/1/files/2") that
      // would otherwise resolve against *our* origin and 404.
      return new URL(value, baseUrl).href;
    } catch {
      return value;
    }
  };

  const hook = (node: Element) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href');
      node.removeAttribute('download');
      if (href && isCanvasFileLink(absolute(href), baseUrl)) {
        // A real href could download (or open a page that does) on any click, middle-click or
        // ctrl-click. File links get a dead href; the app opens them in the viewer instead.
        node.setAttribute('data-canvas-file', absolute(href));
        node.setAttribute('href', '#');
        node.removeAttribute('target');
        return;
      }
      if (href) node.setAttribute('href', absolute(href));
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (node.tagName === 'IMG') {
      const src = node.getAttribute('src');
      if (src) node.setAttribute('src', absolute(src));
    } else if (node.tagName === 'IFRAME') {
      // Only allowed embeds get here (see dropFrames). Their own permissions, nothing more; an embedded page may submit
      // its own forms (a guide's search box), a player may go fullscreen.
      const video = embedKind(node.getAttribute('src')) === 'video';
      node.setAttribute('sandbox', `allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox ${video ? 'allow-presentation' : 'allow-forms'}`);
      node.setAttribute('allow', video ? 'autoplay; fullscreen; picture-in-picture; encrypted-media' : 'fullscreen; clipboard-write');
      node.setAttribute('allowfullscreen', '');
      node.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      node.setAttribute('loading', 'lazy');
    }
  };
  // Any other iframe left (rewriteFrames turned the web ones into links) is removed whole.
  const dropFrames = (node: Node) => {
    if (node instanceof Element && node.tagName === 'IFRAME' && !embedKind(node.getAttribute('src'))) node.remove();
  };

  DOMPurify.addHook('afterSanitizeAttributes', hook);
  DOMPurify.addHook('uponSanitizeElement', dropFrames);
  try {
    return DOMPurify.sanitize(rewriteFrames(html, absolute), { USE_PROFILES: { html: true }, ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder'] });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', hook);
    DOMPurify.removeHook('uponSanitizeElement', dropFrames);
  }
}

export function HtmlContent({ html }: { html: string }) {
  const { baseUrl } = useAuth();
  const { openFile } = useFileViewer();
  const clean = useMemo(() => sanitize(html, baseUrl), [html, baseUrl]);

  // Canvas file links open in the in-app viewer, whatever the click (plain, ctrl, shift).
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a[data-canvas-file]');
    if (!link) return;
    e.preventDefault();
    openFile(link.getAttribute('data-canvas-file') ?? '', fileLinkName(link) || 'File');
  };

  return <div className="canvas-html" onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
}

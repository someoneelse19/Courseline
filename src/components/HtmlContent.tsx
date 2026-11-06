import { useMemo, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { useAuth } from '../context/AuthContext';
import { useFileViewer } from '../context/FileViewerContext';
import { VIDEO_EMBEDS } from '../lib/csp';
import { fileLinkName } from '../lib/html';

// Canvas gives us HTML written by instructors (assignment descriptions, submission
// bodies). We render it, but ONLY after DOMPurify strips scripts, event handlers,
// iframes, javascript: URLs, etc. This matters: our Canvas token sits in localStorage,
// so an XSS here would leak it. Don't bypass this component with dangerouslySetInnerHTML.
// The one kind of iframe kept is a video player from a known host (VIDEO_EMBEDS in lib/csp.ts, which also limits
// frame-src to them): a cross-origin frame cannot read this page or its storage, and it is sandboxed besides.

/** Is this iframe address a video player from one of the known hosts (https only)? */
export function isVideoEmbed(src: string | null): boolean {
  if (!src) return false;
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && !u.username && !u.password && !!VIDEO_EMBEDS[u.origin]?.test(u.pathname);
  } catch {
    return false;
  }
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
      // Only video players get here (see dropFrames). Their own permissions, nothing more.
      node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
      node.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media');
      node.setAttribute('allowfullscreen', '');
      node.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      node.setAttribute('loading', 'lazy');
    }
  };
  // Any other iframe is removed whole.
  const dropFrames = (node: Node) => {
    if (node instanceof Element && node.tagName === 'IFRAME' && !isVideoEmbed(node.getAttribute('src'))) node.remove();
  };

  DOMPurify.addHook('afterSanitizeAttributes', hook);
  DOMPurify.addHook('uponSanitizeElement', dropFrames);
  try {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_TAGS: ['iframe'], ADD_ATTR: ['allowfullscreen', 'frameborder'] });
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

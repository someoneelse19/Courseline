import { useMemo, type MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { useAuth } from '../context/AuthContext';
import { useFileViewer } from '../context/FileViewerContext';
import { fileLinkName } from '../lib/html';

// Canvas gives us HTML written by instructors (assignment descriptions, submission
// bodies). We render it, but ONLY after DOMPurify strips scripts, event handlers,
// iframes, javascript: URLs, etc. This matters: our Canvas token sits in localStorage,
// so an XSS here would leak it. Don't bypass this component with dangerouslySetInnerHTML.
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
    }
  };

  DOMPurify.addHook('afterSanitizeAttributes', hook);
  try {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', hook);
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

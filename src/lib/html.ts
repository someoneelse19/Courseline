// Reading Canvas HTML (assignment descriptions, wiki pages, submission bodies) without rendering it.
// DOMParser builds an inert document: scripts don't run and images don't load.

export interface LinkedFile {
  id: string;
  name: string;
  url: string;
}

/** A Canvas file link's label: its screen-reader text when it has one, without the "Download" prefix Canvas adds. */
export function fileLinkName(link: Element): string {
  const label = link.querySelector('.screenreader-only')?.textContent?.trim() || link.getAttribute('aria-label') || link.textContent || '';
  return label.replace(/^\s*(Descargar|Download)\s+/i, '').trim();
}

/** Files linked from Canvas HTML, once each, in document order. Links without a readable name are skipped. */
export function linkedFiles(html: string): LinkedFile[] {
  if (!html) return [];
  const files = new Map<string, LinkedFile>();
  new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a[href*="/files/"]').forEach((link) => {
    const url = link.getAttribute('href') ?? '';
    const id = link.getAttribute('data-id') || url.match(/\/files\/(\d+)/)?.[1];
    const name = fileLinkName(link);
    if (id && name && !files.has(id)) files.set(id, { id, name, url });
  });
  return [...files.values()];
}

/** The plain text of an HTML fragment. */
export function htmlText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

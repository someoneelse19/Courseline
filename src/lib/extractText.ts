import { htmlToMarkdown } from './htmlToMarkdown';

// Plain text out of a downloaded course file, for the AI export. Returns null when a file has no
// readable text (images, scans, old .doc/.ppt formats, unknown types) or cannot be read; the
// caller just skips the text copy and keeps the original.

const MAX_CHARS = 2_000_000; // a single file's text; longer is cut with a note
const MAX_SHEET_ROWS = 2000;

const PLAIN = ['txt', 'md', 'markdown', 'csv', 'tsv', 'rtf', 'log', 'yml', 'yaml', 'ini', 'tex'];
const CODE = ['java', 'js', 'ts', 'tsx', 'jsx', 'py', 'cpp', 'c', 'h', 'css', 'json', 'xml', 'sql', 'go', 'rs', 'php', 'rb', 'sh', 'r', 'm', 'swift', 'kt', 'cs'];

const extensionOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const clip = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}\n\n[Text cut here: the file is longer than ${MAX_CHARS.toLocaleString()} characters.]` : s);

const byLocalName = (root: Document | Element, name: string): Element[] => Array.from(root.getElementsByTagNameNS('*', name));

function paragraphText(p: Element): string {
  let out = '';
  for (const el of byLocalName(p, '*')) {
    if (el.localName === 't') out += el.textContent ?? '';
    else if (el.localName === 'tab') out += '\t';
    else if (el.localName === 'br') out += '\n';
  }
  return out.trim();
}

async function docxText(bytes: ArrayBuffer): Promise<string | null> {
  const { default: JSZip } = await import('jszip');
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string');
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const lines: string[] = [];
  for (const p of byLocalName(doc, 'p')) {
    const text = paragraphText(p);
    if (!text) continue;
    const style = byLocalName(p, 'pStyle')[0]?.getAttribute('w:val') ?? '';
    const heading = style.match(/^Heading(\d)/i);
    if (heading) lines.push(`${'#'.repeat(Math.min(6, Number(heading[1])))} ${text}`);
    else if (/^Title$/i.test(style)) lines.push(`# ${text}`);
    else if (byLocalName(p, 'numPr').length > 0) lines.push(`- ${text}`);
    else lines.push(text);
  }
  return lines.length ? lines.join('\n\n') : null;
}

async function pptxText(bytes: ArrayBuffer): Promise<string | null> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .map((path) => ({ path, n: Number(path.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter((s) => Number.isFinite(s.n))
    .sort((a, b) => a.n - b.n);
  const parse = async (path: string) => new DOMParser().parseFromString((await zip.file(path)?.async('string')) ?? '', 'application/xml');
  const linesOf = (doc: Document) => byLocalName(doc, 'p').map(paragraphText).filter((t) => t && !/^\d+$/.test(t)); // slide-number placeholders are bare digits

  const out: string[] = [];
  for (const { path, n } of slides) {
    const body = linesOf(await parse(path));
    // The speaker notes are linked through the slide's relationships file.
    const rels = await parse(`ppt/slides/_rels/slide${n}.xml.rels`);
    const target = byLocalName(rels, 'Relationship')
      .find((r) => (r.getAttribute('Type') ?? '').endsWith('/notesSlide'))
      ?.getAttribute('Target');
    const notes = target ? linesOf(await parse(`ppt/notesSlides/${target.split('/').pop()}`)) : [];
    if (body.length === 0 && notes.length === 0) continue;
    out.push([`## Slide ${n}`, ...body, ...(notes.length ? ['', '**Speaker notes:**', ...notes] : [])].join('\n\n'));
  }
  return out.length ? out.join('\n\n') : null;
}

async function spreadsheetText(bytes: ArrayBuffer): Promise<string | null> {
  const xlsx = await import('xlsx');
  const wb = xlsx.read(bytes, { type: 'array', sheetRows: MAX_SHEET_ROWS + 1 });
  const parts = wb.SheetNames.map((name) => {
    const csv = xlsx.utils.sheet_to_csv(wb.Sheets[name]).trim();
    return csv ? `## Sheet: ${name}\n\n${csv}` : '';
  }).filter(Boolean);
  return parts.length ? parts.join('\n\n') : null;
}

class Timeout extends Error {}
const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Timeout()), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });

async function pdfText(bytes: ArrayBuffer): Promise<string | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  const open = async () => {
    try {
      return await withTimeout(pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise, 10_000);
    } catch (err) {
      if (!(err instanceof Timeout)) throw err;
      // The background worker never answered: parse on the main thread instead (same fallback as the viewer).
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
      return pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    }
  };
  const doc = await open();
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
      if (text) pages.push(`## Page ${i}\n\n${text}`);
    }
    return pages.length ? pages.join('\n\n') : null; // null: probably scanned images
  } finally {
    void doc.destroy();
  }
}

export async function extractText(bytes: ArrayBuffer, name: string, contentType = ''): Promise<string | null> {
  const ext = extensionOf(name);
  try {
    let text: string | null = null;
    if (PLAIN.includes(ext) || (contentType.startsWith('text/') && ext !== 'html' && ext !== 'htm')) text = new TextDecoder().decode(bytes);
    else if (ext === 'html' || ext === 'htm') text = htmlToMarkdown(new TextDecoder().decode(bytes));
    else if (CODE.includes(ext)) text = `\`\`\`${ext}\n${new TextDecoder().decode(bytes).replace(/\n+$/, '')}\n\`\`\``;
    else if (ext === 'pdf' || contentType.includes('pdf')) text = await pdfText(bytes);
    else if (['docx', 'docm'].includes(ext) || contentType.includes('wordprocessingml')) text = await docxText(bytes);
    else if (['pptx', 'pptm', 'ppsx'].includes(ext) || contentType.includes('presentationml')) text = await pptxText(bytes);
    else if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext) || /spreadsheetml|ms-excel/.test(contentType)) text = await spreadsheetText(bytes);
    const trimmed = text?.trim();
    return trimmed ? clip(trimmed) : null;
  } catch (err) {
    console.warn('[ai export] could not read text from', name, err);
    return null;
  }
}

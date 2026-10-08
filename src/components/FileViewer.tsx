import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { CanvasApiError } from '../api/client';
import { useApi } from '../context/AuthContext';
import { ErrorMessage, Spinner } from './ui';

const Editor = lazy(() => import('@monaco-editor/react').then(m => ({ default: m.default })));

interface FileViewerProps {
  fileUrl: string;
  fileName: string;
  contentType?: string;
  onClose: () => void;
}

function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

type FileCategory = 'code' | 'image' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'legacy-office' | 'unsupported';

function getFileTypeCategory(ext: string, contentType?: string): FileCategory {
  const codeExts = ['java', 'js', 'ts', 'py', 'cpp', 'c', 'tsx', 'jsx', 'html', 'css', 'json', 'xml', 'sql', 'go', 'rs', 'php'];
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
  const type = contentType ?? '';

  if (codeExts.includes(ext)) return 'code';
  if (imageExts.includes(ext)) return 'image';
  if (ext === 'pdf' || type.includes('pdf')) return 'pdf';
  if (['docx', 'docm'].includes(ext) || type.includes('wordprocessingml')) return 'docx';
  if (['xlsx', 'xlsm', 'xls', 'xlsb', 'csv', 'tsv', 'ods'].includes(ext) || /spreadsheetml|ms-excel|text\/csv/.test(type)) return 'xlsx';
  if (['pptx', 'pptm', 'ppsx'].includes(ext) || type.includes('presentationml')) return 'pptx';
  // Pre-2007 binary formats: no browser-side renderer exists for these.
  if (['doc', 'ppt'].includes(ext) || /msword|ms-powerpoint/.test(type)) return 'legacy-office';
  return 'unsupported';
}

function getMonacoLanguage(ext: string): string {
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    cpp: 'cpp',
    c: 'c',
    java: 'java',
    html: 'html',
    css: 'css',
    json: 'json',
    xml: 'xml',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    php: 'php',
  };
  return langMap[ext] || 'plaintext';
}

function CodeViewer({ fileUrl, fileName, zoom }: { fileUrl: string; fileName: string; zoom: number }) {
  const ext = getFileExtension(fileName);
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchCode = async () => {
      try {
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error('Failed to load file');
        const text = await res.text();
        setCode(text);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };
    fetchCode();
  }, [fileUrl]);

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <Suspense fallback={<Spinner />}>
      <div className="h-full overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
        <Editor
          height="100%"
          language={getMonacoLanguage(ext)}
          value={code}
          options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: Math.round(14 * zoom) }}
          theme="vs-dark"
        />
      </div>
    </Suspense>
  );
}

function ImageViewer({ fileUrl, fileName, zoom }: { fileUrl: string; fileName: string; zoom: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; fit: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  return (
    <div ref={boxRef} className="h-full overflow-auto rounded-lg bg-neutral-100 p-4 dark:bg-neutral-800">
      {error && <ErrorMessage error={error} />}
      {!natural && !error && <Spinner />}
      <img
        src={fileUrl}
        alt={fileName}
        onLoad={(e) => {
          const w = e.currentTarget.naturalWidth;
          // At 100% the image fits the panel (never upscaled); zoom scales from there.
          setNatural({ w, fit: Math.min(1, ((boxRef.current?.clientWidth ?? w) - 32) / w) });
        }}
        onError={() => setError(new Error('Failed to load image'))}
        className="mx-auto block h-auto max-w-none rounded-sm"
        style={natural ? { width: natural.w * natural.fit * zoom } : { visibility: 'hidden', width: 0 }}
      />
    </div>
  );
}

// PDFs are drawn with PDF.js rather than the browser's PDF plugin (which can silently show a blank
// frame for a downloaded copy). Pages render lazily as they scroll into view.
// The "legacy" build runs on older browsers too. A PDF.js worker that fails to start can leave its
// promises pending forever, so every stage reports progress and the whole thing has a time limit.
type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;
const PDF_TIMEOUT_MS = 60_000;
const WORKER_OPEN_MS = 10_000;

// Once the background worker has failed to answer, don't wait for it again this session.
let pdfWorkerUnresponsive = false;

class TimeoutError extends Error {}
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError()), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

type PdfState = { status: 'loading'; stage: string } | { status: 'error'; message: string } | { status: 'ready'; pdf: PdfDoc };

function PdfViewer({ fileUrl, zoom }: { fileUrl: string; zoom: number }) {
  // Width of a page at 100%: 800px, or less on a narrow screen.
  const baseWidth = useMemo(() => Math.min(800, Math.max(280, window.innerWidth - 96)), []);
  const [state, setState] = useState<PdfState>({ status: 'loading', stage: 'Reading the file…' });

  useEffect(() => {
    let settled = false;
    let doc: PdfDoc | null = null;
    let stage = 'reading the file';
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      setState({ status: 'error', message });
    };
    const step = (label: string, doing: string) => {
      stage = doing;
      if (!settled) setState({ status: 'loading', stage: label });
    };
    const watchdog = setTimeout(() => fail(`timed out while ${stage}`), PDF_TIMEOUT_MS);

    (async () => {
      try {
        const data = new Uint8Array(await (await fetch(fileUrl)).arrayBuffer());
        // Canvas (or the dev proxy) can answer with a login/error page instead of the file.
        if (String.fromCharCode(...data.slice(0, 5)) !== '%PDF-') throw new Error("the download wasn't a PDF (Canvas may have returned an error page)");
        step('Loading the PDF viewer…', 'loading the PDF viewer');
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
        step('Opening the document…', 'opening the document');
        // PDF.js parses in a background worker. If that never answers (blocked, or a browser/extension
        // quirk), PDF.js waits forever, so after a few seconds redo it on the main thread instead
        // (setting globalThis.pdfjsWorker makes PDF.js use the worker code in-page).
        const openOnMainThread = async () => {
          step('Opening the document (compatibility mode)…', 'opening the document in compatibility mode');
          (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
          return pdfjs.getDocument({ data }).promise;
        };
        if (pdfWorkerUnresponsive) {
          doc = await openOnMainThread();
        } else {
          const attempt = pdfjs.getDocument({ data: data.slice() });
          try {
            doc = await withTimeout(attempt.promise, WORKER_OPEN_MS);
          } catch (err) {
            if (!(err instanceof TimeoutError)) throw err;
            console.warn('[file viewer] PDF worker did not respond; opening on the main thread');
            pdfWorkerUnresponsive = true;
            void attempt.destroy();
            doc = await openOnMainThread();
          }
        }
        if (settled) return void doc.loadingTask.destroy();
        settled = true;
        setState({ status: 'ready', pdf: doc });
      } catch (err) {
        console.warn('[file viewer] PDF failed while ' + stage, err);
        fail(err instanceof Error && err.message ? err.message : 'unknown error');
      }
    })();

    return () => {
      settled = true;
      clearTimeout(watchdog);
      void doc?.loadingTask.destroy();
    };
  }, [fileUrl]);

  if (state.status === 'loading') return <Spinner label={state.stage} />;
  if (state.status === 'error') return <p className="p-4 text-sm text-neutral-600 dark:text-neutral-400">Couldn't render this PDF: {state.message}.</p>;
  return (
    <div data-scroll-frame className="h-full space-y-3 overflow-auto rounded-lg bg-neutral-200 p-3 dark:bg-neutral-800">
      {Array.from({ length: state.pdf.numPages }, (_, i) => (
        <PdfPage key={i} pdf={state.pdf} pageNumber={i + 1} width={Math.round(baseWidth * zoom)} />
      ))}
    </div>
  );
}

function PdfPage({ pdf, pageNumber, width }: { pdf: PdfDoc; pageNumber: number; width: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.3); // height/width placeholder until the page size is known
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Re-renders at the new size when `width` (zoom) changes, so text stays sharp instead of being stretched.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: import('pdfjs-dist').RenderTask | undefined;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const cssScale = width / base.width;
      let pixelScale = Math.min(window.devicePixelRatio || 1, 2);
      // Keep each canvas under ~16 megapixels so high zoom can't exhaust memory.
      const area = base.width * base.height * (cssScale * pixelScale) ** 2;
      if (area > 16e6) pixelScale *= Math.sqrt(16e6 / area);
      const viewport = page.getViewport({ scale: cssScale * pixelScale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      await task.promise;
    })().catch((err) => {
      if (err?.name !== 'RenderingCancelledException') console.warn('[file viewer] PDF page failed', err);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, pdf, pageNumber, width]);

  return (
    <div ref={wrapRef} data-pdf-page className="mx-auto bg-white shadow-sm" style={{ width, aspectRatio: `1 / ${ratio}` }}>
      {/* keyed by width: every size gets a fresh canvas, so a cancelled render can never collide with the next one */}
      <canvas key={width} ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

// ---- Microsoft Office viewers (all client-side; the file never leaves the browser) ----

const OFFICE_TIMEOUT_MS = 30_000;

/**
 * Loads the local copy of the file, then lets `draw` render it into a fresh element. Rendering into a
 * per-run child (instead of the shared container) means a superseded run, such as React's dev
 * double-mount, can never leave a second copy of the document behind.
 */
function useOfficeRender(fileUrl: string, draw: (bytes: ArrayBuffer, host: HTMLElement) => Promise<(() => void) | void>) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{ state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string }>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | void;
    const container = ref.current;
    const host = document.createElement('div');
    container?.appendChild(host);
    setStatus({ state: 'loading' });

    (async () => {
      try {
        const bytes = await (await fetch(fileUrl)).arrayBuffer();
        if (cancelled) return;
        dispose = await withTimeout(draw(bytes, host), OFFICE_TIMEOUT_MS);
        if (cancelled) return dispose?.();
        setStatus({ state: 'ready' });
      } catch (err) {
        console.warn('[file viewer] Office preview failed', err);
        if (cancelled) return;
        setStatus({
          state: 'error',
          message: err instanceof TimeoutError ? 'it took too long to render' : err instanceof Error && err.message ? err.message : 'unknown error',
        });
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
      host.remove();
    };
  }, [fileUrl]);

  return { ref, status };
}

function OfficeStatus({ status, what }: { status: { state: string; message?: string }; what: string }) {
  if (status.state === 'loading') return <Spinner label={`Rendering ${what}…`} />;
  if (status.state === 'error') return <p className="p-4 text-sm text-neutral-600 dark:text-neutral-400">Couldn't render this {what}: {status.message}.</p>;
  return null;
}

const frameBase = 'overflow-auto rounded-lg border border-neutral-300 dark:border-neutral-700';
const officeFrame = `${frameBase} h-full bg-neutral-200 p-3 dark:bg-neutral-800 [&>div]:[zoom:var(--z)]`;
const zoomVar = (zoom: number) => ({ ['--z' as string]: zoom }) as React.CSSProperties;

function DocxViewer({ fileUrl, zoom }: { fileUrl: string; zoom: number }) {
  const { ref, status } = useOfficeRender(fileUrl, async (bytes, host) => {
    const { renderAsync } = await import('docx-preview');
    await renderAsync(bytes, host, undefined, { className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true });
    // Hyperlinks come straight from the document: keep only web/mail links, never javascript: and co.
    host.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      } else a.removeAttribute('href');
    });
  });
  return (
    <>
      <OfficeStatus status={status} what="Word document" />
      <div ref={ref} data-scroll-frame style={zoomVar(zoom)} className={`${officeFrame} ${status.state === 'ready' ? '' : 'hidden'}`} />
    </>
  );
}

const MAX_SHEET_ROWS = 2000;

function ExcelViewer({ fileUrl, zoom }: { fileUrl: string; zoom: number }) {
  type Book = { xlsx: typeof import('xlsx'); wb: import('xlsx').WorkBook; names: string[] };
  const [book, setBook] = useState<Book | null>(null);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<{ state: 'loading' } | { state: 'ready' } | { state: 'error'; message: string }>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setStatus({ state: 'loading' });
    setActive(0);
    (async () => {
      try {
        const bytes = await (await fetch(fileUrl)).arrayBuffer();
        const xlsx = await import('xlsx');
        // sheetRows caps how much is parsed, so a huge workbook can't freeze the page.
        const wb = await withTimeout(Promise.resolve(xlsx.read(bytes, { type: 'array', cellDates: true, sheetRows: MAX_SHEET_ROWS + 1 })), OFFICE_TIMEOUT_MS);
        if (cancelled) return;
        const hidden = new Set((wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name));
        const names = wb.SheetNames.filter((n) => !hidden.has(n));
        if (names.length === 0) throw new Error('the workbook has no visible sheets');
        setBook({ xlsx, wb, names });
        setStatus({ state: 'ready' });
      } catch (err) {
        console.warn('[file viewer] spreadsheet failed', err);
        if (!cancelled) setStatus({ state: 'error', message: err instanceof TimeoutError ? 'it took too long to read' : err instanceof Error ? err.message : 'unknown error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  const sheet = useMemo(() => {
    if (!book) return null;
    const ws = book.wb.Sheets[book.names[active]];
    if (!ws) return null;
    const ref = ws['!fullref'] ?? ws['!ref'];
    const range = ref ? book.xlsx.utils.decode_range(ref) : null;
    const total = range ? range.e.r - range.s.r + 1 : 0;
    return { html: sanitizeSheetHtml(book.xlsx.utils.sheet_to_html(ws)), cut: total > MAX_SHEET_ROWS ? total : 0 };
  }, [book, active]);

  if (status.state !== 'ready' || !book || !sheet) return <OfficeStatus status={status} what="spreadsheet" />;
  return (
    <div className="flex h-full flex-col gap-2">
      {book.names.length > 1 && (
        <div className="flex shrink-0 flex-wrap gap-1" role="tablist">
          {book.names.map((n, i) => (
            <button
              key={n}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`rounded-md px-3 py-1 text-sm ${
                i === active ? 'bg-accent-600 text-white' : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div className={`${frameBase} xlsx-sheet min-h-0 flex-1 bg-white dark:bg-neutral-900`}>
        <div style={{ zoom }} dangerouslySetInnerHTML={{ __html: sheet.html }} />
      </div>
      {sheet.cut > 0 && (
        <p className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
          Showing the first {MAX_SHEET_ROWS.toLocaleString()} of {sheet.cut.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}

// The sheet's cell text is untrusted (it comes from the file), so the generated HTML is sanitized
// before it is injected. Our Canvas token lives in localStorage; never skip this.
function sanitizeSheetHtml(html: string): string {
  const hook = (node: Element) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  };
  DOMPurify.addHook('afterSanitizeAttributes', hook);
  try {
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', hook);
  }
}

// Slide shape comes from the file itself (<p:sldSz cx= cy=> in ppt/presentation.xml), so 4:3, 16:9 and
// custom sizes all get a correctly shaped slide instead of being squeezed into 16:9.
async function slideAspect(bytes: ArrayBuffer): Promise<number> {
  try {
    const { default: JSZip } = await import('jszip');
    const xml = (await (await JSZip.loadAsync(bytes)).file('ppt/presentation.xml')?.async('string')) ?? '';
    const tag = xml.match(/<p:sldSz\b[^>]*>/)?.[0] ?? '';
    const cx = Number(tag.match(/\bcx="(\d+)"/)?.[1]);
    const cy = Number(tag.match(/\bcy="(\d+)"/)?.[1]);
    return cx > 0 && cy > 0 ? cy / cx : 9 / 16;
  } catch {
    return 9 / 16;
  }
}

function PptxViewer({ fileUrl, zoom }: { fileUrl: string; zoom: number }) {
  const { ref, status } = useOfficeRender(fileUrl, async (bytes, host) => {
    const { init } = await import('pptx-preview');
    const width = Math.max(320, Math.min(host.clientWidth || 800, 1100));
    const height = Math.round(width * (await slideAspect(bytes)));
    const previewer = init(host, { width, height, mode: 'list' });
    await previewer.preview(bytes);
    // The library boxes all slides into a wrapper one slide tall that scrolls on its own. Let the
    // slides stack instead, so the viewer's single scroll area (and its page tracking) covers them all.
    const wrapper = host.querySelector<HTMLElement>('.pptx-preview-wrapper');
    if (wrapper) {
      wrapper.style.height = 'auto';
      wrapper.style.overflow = 'visible';
    }
    // For a chart whose file has no title, the slide library draws a Chinese placeholder ("chart title").
    // PowerPoint shows nothing there, so blank it (charts render a moment later, hence the observer).
    const blankPlaceholder = () =>
      host.querySelectorAll('svg text').forEach((t) => {
        if (t.textContent?.trim() === '图表标题') t.textContent = '';
      });
    const observer = new MutationObserver(blankPlaceholder);
    observer.observe(host, { childList: true, subtree: true });
    blankPlaceholder();
    return () => {
      observer.disconnect();
      previewer.destroy();
    };
  });
  return (
    <>
      <OfficeStatus status={status} what="presentation" />
      <div ref={ref} data-scroll-frame style={zoomVar(zoom)} className={`${officeFrame} ${status.state === 'ready' ? '' : 'hidden'}`} />
    </>
  );
}

function UnsupportedViewer({ fileUrl, fileName, note }: { fileUrl: string; fileName: string; note?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 rounded-lg border border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
      <div className="text-4xl">📄</div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{fileName}</p>
      {note && <p className="max-w-md text-center text-xs text-neutral-500 dark:text-neutral-400">{note}</p>}
      <a
        href={fileUrl}
        download={fileName}
        className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
      >
        Download file
      </a>
    </div>
  );
}

interface ResolvedFile {
  url: string; // object URL (or a direct link when the download was blocked, or for non-Canvas links)
  name: string;
  contentType?: string;
}

type ViewerState =
  | { status: 'loading' }
  // `download` is set when we know the signed link but couldn't fetch the bytes; it is only ever
  // offered behind an explicit "Download file" button.
  | { status: 'error'; reason: string; download?: { url: string; name: string } }
  | { status: 'ready'; file: ResolvedFile };

function describeFailure(err: unknown): string {
  if (err instanceof CanvasApiError) {
    if (err.status === 0)
      return 'Your browser blocked the download (CORS). Setting VITE_USE_DEV_PROXY=true in .env and restarting npm run dev usually fixes this.';
    if (err.status === 401 || err.status === 403) return 'Canvas denied access to this file (it may be locked or hidden).';
    if (err.status === 404) return "Canvas couldn't find this file (it may have been deleted).";
    return `Canvas returned an error (${err.status}).`;
  }
  return `The file could not be loaded${err instanceof Error && err.message ? ` (${err.message})` : ''}.`;
}

// Canvas links in page/assignment HTML point at its web UI (/courses/1/files/2), which needs a
// login session and can't be embedded. Instead: GET /files/:id (API token) -> pre-signed URL
// -> download the bytes -> show the local copy. Signed URLs expire, so nothing is cached.
function useResolvedFile(fileUrl: string, fileName: string, contentType?: string) {
  const api = useApi();
  const [state, setState] = useState<ViewerState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });

    (async () => {
      const id = fileUrl.match(/\/files\/(\d+)/)?.[1];
      if (!id) {
        setState({ status: 'error', reason: 'This link is not a Canvas file.' });
        return;
      }

      let meta;
      try {
        meta = await api.getFile(id);
      } catch (err) {
        console.warn('[file viewer] lookup failed', err);
        if (!cancelled) setState({ status: 'error', reason: describeFailure(err) });
        return;
      }
      const type = meta['content-type'] ?? contentType;
      const name = meta.display_name || fileName;

      try {
        const blob = await api.downloadFile(meta.url);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(type ? new Blob([blob], { type }) : blob);
        setState({ status: 'ready', file: { url: objectUrl, name, contentType: type } });
      } catch (err) {
        console.warn('[file viewer] download failed', err);
        if (cancelled) return;
        setState({ status: 'error', reason: describeFailure(err), download: { url: meta.url, name } });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, fileUrl, fileName, contentType]);

  return state;
}

const PREVIEWABLE: FileCategory[] = ['code', 'image', 'pdf', 'docx', 'xlsx', 'pptx'];

// Zoom: preset steps for the +/- buttons and keys; any value in between can be typed.
const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
const MIN_ZOOM = ZOOM_PRESETS[0];
const MAX_ZOOM = ZOOM_PRESETS[ZOOM_PRESETS.length - 1];
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const stepZoom = (z: number, dir: 1 | -1) =>
  dir > 0 ? (ZOOM_PRESETS.find((p) => p > z + 1e-6) ?? MAX_ZOOM) : ([...ZOOM_PRESETS].reverse().find((p) => p < z - 1e-6) ?? MIN_ZOOM);

const toolbarButton =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800';
const fieldBox =
  'flex items-center rounded-md border border-neutral-300 px-2 py-1 text-sm focus-within:ring-2 focus-within:ring-accent-500 dark:border-neutral-700';

/** A small whole-number box: type a value, Enter (or leaving the box) applies it, Escape cancels. */
function NumberField({ value, onCommit, ariaLabel, title, width = 'w-10' }: { value: number; onCommit: (n: number) => void; ariaLabel: string; title?: string; width?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n)) onCommit(n);
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      title={title}
      value={draft ?? String(value)}
      onFocus={(e) => {
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur(); // the blur applies it
        else if (e.key === 'Escape') {
          e.stopPropagation(); // cancels the edit; a second Esc closes the viewer
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={commit}
      className={`${width} bg-transparent text-right tabular-nums outline-hidden`}
    />
  );
}

function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out (-)" disabled={zoom <= MIN_ZOOM + 1e-6} onClick={() => setZoom(stepZoom(zoom, -1))} className={toolbarButton}>
        −
      </button>
      <div className={fieldBox}>
        <NumberField ariaLabel="Zoom percent" title="Type a zoom from 25 to 500, then press Enter (0 resets to 100%)" value={Math.round(zoom * 100)} onCommit={(n) => setZoom(clampZoom(n / 100))} />
        <span className="text-neutral-500 dark:text-neutral-400">%</span>
      </div>
      <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={zoom >= MAX_ZOOM - 1e-6} onClick={() => setZoom(stepZoom(zoom, 1))} className={toolbarButton}>
        +
      </button>
    </div>
  );
}

function PageControls({ label, current, total, goTo }: { label: string; current: number; total: number; goTo: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 text-sm" role="group" aria-label={`${label} navigation`}>
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <div className={fieldBox}>
        <NumberField ariaLabel={`${label} number`} title={`Type a ${label.toLowerCase()} number and press Enter to jump to it`} value={current} onCommit={(n) => goTo(Math.min(total, Math.max(1, n)))} width="w-8" />
      </div>
      <span className="text-neutral-500 dark:text-neutral-400">of {total}</span>
    </div>
  );
}

// Which elements are "pages" in each paged preview, and what to call them.
const PAGE_SELECTOR: Partial<Record<FileCategory, { selector: string; label: string }>> = {
  pdf: { selector: '[data-pdf-page]', label: 'Page' },
  docx: { selector: '.docx-wrapper > section', label: 'Page' },
  pptx: { selector: '.pptx-preview-slide-wrapper', label: 'Slide' },
};

/** Current page = the one most visible in the scroll area; goTo scrolls a page to the top. Re-measures on scroll, zoom, resize and new content. */
function usePagination(bodyRef: React.RefObject<HTMLElement>, category: FileCategory, zoom: number, ready: boolean) {
  const spec = PAGE_SELECTOR[category];
  const [info, setInfo] = useState({ current: 1, total: 0 });
  const frameOf = () => bodyRef.current?.querySelector<HTMLElement>('[data-scroll-frame]') ?? null;

  const measure = useCallback(() => {
    const frame = frameOf();
    if (!spec || !frame) return setInfo((i) => (i.total === 0 ? i : { current: 1, total: 0 }));
    const pages = Array.from(frame.querySelectorAll<HTMLElement>(spec.selector));
    const box = frame.getBoundingClientRect();
    let best = 0;
    let bestOverlap = -Infinity;
    pages.forEach((p, i) => {
      const r = p.getBoundingClientRect();
      const overlap = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
      if (overlap > bestOverlap + 0.5) {
        bestOverlap = overlap;
        best = i;
      }
    });
    setInfo((i) => (i.current === best + 1 && i.total === pages.length ? i : { current: best + 1, total: pages.length }));
  }, [spec]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !spec || !ready) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    body.addEventListener('scroll', schedule, true); // scroll doesn't bubble: capture it from the frame inside
    const mo = new MutationObserver(schedule); // documents render asynchronously
    mo.observe(body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      body.removeEventListener('scroll', schedule, true);
      mo.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [bodyRef, spec, ready, measure]);

  useEffect(() => {
    const raf = requestAnimationFrame(measure); // zoom changes the layout without any DOM change
    return () => cancelAnimationFrame(raf);
  }, [zoom, measure]);

  /** Which page is being read and where the middle of the view sits within it: survives a size change (zoom is about the center). */
  const anchor = useCallback((): { index: number; frac: number } | null => {
    const frame = frameOf();
    if (!spec || !frame) return null;
    const pages = Array.from(frame.querySelectorAll<HTMLElement>(spec.selector));
    if (pages.length === 0) return null;
    const box = frame.getBoundingClientRect();
    let best = 0;
    let bestOverlap = -Infinity;
    pages.forEach((p, i) => {
      const r = p.getBoundingClientRect();
      const overlap = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
      if (overlap > bestOverlap + 0.5) {
        bestOverlap = overlap;
        best = i;
      }
    });
    const r = pages[best].getBoundingClientRect();
    return { index: best, frac: r.height > 0 ? (box.top + box.height / 2 - r.top) / r.height : 0 };
  }, [spec]);

  const restore = useCallback(
    (a: { index: number; frac: number }) => {
      const frame = frameOf();
      const el = frame && spec ? frame.querySelectorAll<HTMLElement>(spec.selector)[a.index] : null;
      if (!frame || !el) return;
      const r = el.getBoundingClientRect();
      const box = frame.getBoundingClientRect();
      frame.scrollTop += r.top + a.frac * r.height - (box.top + box.height / 2);
    },
    [spec],
  );

  const goTo = useCallback(
    (n: number) => {
      const frame = frameOf();
      if (!frame || !spec) return;
      const el = frame.querySelectorAll<HTMLElement>(spec.selector)[n - 1];
      if (el) frame.scrollTo({ top: frame.scrollTop + el.getBoundingClientRect().top - frame.getBoundingClientRect().top });
    },
    [spec],
  );

  return { ...info, label: spec?.label ?? '', paged: !!spec, goTo, anchor, restore };
}

/** The viewer panel: a header bar (title + actions) over a body that fills the rest. `tall` panels fill most of the screen. */
function Shell({ title, onClose, toolbar, tall, children }: { title: string; onClose: () => void; toolbar?: React.ReactNode; tall?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900 ${
        tall ? 'h-[90vh]' : 'max-h-[90vh]'
      }`}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h2 className="min-w-32 flex-1 truncate text-sm font-semibold" title={title}>
          {title}
        </h2>
        {toolbar}
        <button type="button" onClick={onClose} aria-label="Close" className={toolbarButton}>
          ✕ Close
        </button>
      </header>
      <div className={`min-h-0 p-3 ${tall ? 'flex-1' : 'overflow-auto'}`}>{children}</div>
    </div>
  );
}

export function FileViewer({ fileUrl, fileName, contentType, onClose }: FileViewerProps) {
  const state = useResolvedFile(fileUrl, fileName, contentType);
  const [zoom, setZoomRaw] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const readyFile = state.status === 'ready' ? state.file : null;
  const category = readyFile ? getFileTypeCategory(getFileExtension(readyFile.name), readyFile.contentType) : 'unsupported';
  const pages = usePagination(bodyRef, category, zoom, !!readyFile);
  const place = useRef<{ index: number; frac: number } | null>(null);
  // Remember which page you're on (and how far into it), so zooming doesn't throw you to another page.
  const { anchor, restore } = pages;
  const setZoom = useCallback(
    (next: number | ((z: number) => number)) => {
      place.current = anchor();
      setZoomRaw(next);
    },
    [anchor],
  );
  useLayoutEffect(() => {
    if (place.current) restore(place.current);
    place.current = null;
  }, [zoom, restore]);

  // + / - / 0 zoom the open file (Ctrl/Cmd combinations are left to the browser's own page zoom).
  // Ignored while typing in a field, so entering "150" in the zoom box doesn't also press 0.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === '0') return setZoom(1);
      const step = e.key === '+' || e.key === '=' ? 1 : e.key === '-' ? -1 : 0;
      if (step) setZoom((z) => stepZoom(z, step));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (state.status === 'loading')
    return (
      <Shell title={fileName} onClose={onClose}>
        <Spinner label="Loading file…" />
      </Shell>
    );

  if (state.status === 'error')
    return (
      <Shell title={fileName} onClose={onClose}>
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-4xl">📄</div>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">This file can't be previewed here.</p>
          <p className="max-w-md text-xs text-neutral-500 dark:text-neutral-400">{state.reason}</p>
          {state.download && (
            <a
              href={state.download.url}
              download={state.download.name}
              className="rounded-md bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-700"
            >
              Download file
            </a>
          )}
        </div>
      </Shell>
    );

  const { url, name } = state.file;
  const previewable = PREVIEWABLE.includes(category);

  return (
    <Shell
      title={name}
      onClose={onClose}
      tall={previewable}
      toolbar={
        previewable && (
          <>
            {pages.paged && pages.total > 0 && <PageControls label={pages.label} current={pages.current} total={pages.total} goTo={pages.goTo} />}
            <ZoomControls zoom={zoom} setZoom={setZoom} />
            {/* The only way a file is ever saved: an explicit click. Saves the local copy under its real name. */}
            <a href={url} download={name} className={`${toolbarButton} bg-accent-600 text-white hover:bg-accent-700 dark:border-accent-600`}>
              ⬇ Download
            </a>
          </>
        )
      }
    >
      <div ref={bodyRef} className="h-full">
        {category === 'code' && <CodeViewer fileUrl={url} fileName={name} zoom={zoom} />}
        {category === 'image' && <ImageViewer fileUrl={url} fileName={name} zoom={zoom} />}
        {category === 'pdf' && <PdfViewer fileUrl={url} zoom={zoom} />}
        {category === 'docx' && <DocxViewer fileUrl={url} zoom={zoom} />}
        {category === 'xlsx' && <ExcelViewer fileUrl={url} zoom={zoom} />}
        {category === 'pptx' && <PptxViewer fileUrl={url} zoom={zoom} />}
        {category === 'legacy-office' && (
          <UnsupportedViewer
            fileUrl={url}
            fileName={name}
            note="This is an older Office format (.doc / .ppt) that browsers can't preview. Download it, or ask for a .docx / .pptx."
          />
        )}
        {category === 'unsupported' && <UnsupportedViewer fileUrl={url} fileName={name} />}
      </div>
    </Shell>
  );
}

import JSZip from 'jszip';
import type { Assignment, Course, CourseFile, Module, Page } from '../api/types';
import { assignFilePaths, buildCourseExport, slugify, type ExportFileInfo } from './courseExport';
import { extractText } from './extractText';
import { linkedFiles } from './html';

// Gathers a course from Canvas and packs the AI export zip (what to put in it: courseExport.ts).
// Two steps so the user can see what is there (and how big) before choosing what to download:
// scanCourse() reads the text content and lists the files; packExport() downloads files and zips.

/** The parts of the Canvas API this needs (the real one is `createCanvasApi(...)`). */
export interface ExportApi {
  getCourseSyllabus(courseId: number): Promise<Course>;
  getModules(courseId: number): Promise<Module[]>;
  getPages(courseId: number, loadModules?: () => Promise<Module[]>): Promise<Page[]>;
  getAssignments(courseId: number): Promise<Assignment[]>;
  getCourseFiles(courseId: number): Promise<CourseFile[] | null>;
  getFile(fileId: number | string): Promise<CourseFile>;
  downloadFile(url: string): Promise<Blob>;
}

export interface ScanResult {
  course: Course;
  syllabusHtml: string | null;
  modules: Module[];
  pages: Page[];
  assignments: Assignment[];
  files: CourseFile[];
  /** Things that could not be read, in plain words (a hidden Pages tab, a file Canvas refused, …). */
  warnings: string[];
}

export interface ExportOptions {
  includeOriginals: boolean;
  extractText: boolean;
  maxFileBytes: number;
}

export type ExportProgress =
  | { stage: 'reading' }
  | { stage: 'finding-files'; done: number; total: number }
  | { stage: 'files'; done: number; total: number; name: string }
  | { stage: 'packing' };

export interface ExportSummary {
  fileName: string;
  documents: number;
  units: number;
  pages: number;
  assignments: number;
  originals: number;
  textFiles: number;
  bytes: number;
  /** Files that are missing or only partly included, with the reason. */
  notes: { name: string; note: string }[];
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
    this.name = 'ExportCancelled';
  }
}

const POOL = 3; // downloads at a time: quick, but gentle on Canvas's rate limit

/** Runs `fn` over `items`, `size` at a time, in order of start. */
async function pool<T>(items: T[], size: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

async function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const reasonOf = (err: unknown) => (err instanceof Error && err.message ? err.message : 'unknown error');

export async function scanCourse(
  api: ExportApi,
  courseId: number,
  onProgress: (p: ExportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<ScanResult> {
  const warnings: string[] = [];
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  /** Most parts are optional (courses hide tabs): a failure becomes a warning, not an error. */
  const optional = async <T,>(what: string, p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      warnings.push(`${what}: ${reasonOf(err)}`);
      return fallback;
    }
  };

  onProgress({ stage: 'reading' });
  const course = await api.getCourseSyllabus(courseId); // required: without it there is no course
  const modulesPromise = api.getModules(courseId);
  const [modules, pages, assignments, courseFiles] = await Promise.all([
    optional('Units', modulesPromise, [] as Module[]),
    optional('Pages', api.getPages(courseId, () => modulesPromise), [] as Page[]),
    optional('Assignments', api.getAssignments(courseId), [] as Assignment[]),
    optional('Files', api.getCourseFiles(courseId), null as CourseFile[] | null),
  ]);
  stopIfCancelled();

  // Every file the course points at: its Files area, unit items, and links inside the HTML.
  const files = new Map<number, CourseFile>((courseFiles ?? []).map((f) => [f.id, f]));
  const wanted = new Set<number>();
  for (const m of modules) for (const i of m.items ?? []) if (i.type === 'File' && i.content_id) wanted.add(i.content_id);
  for (const html of [course.syllabus_body, ...pages.map((p) => p.body), ...assignments.map((a) => a.description)]) {
    for (const f of linkedFiles(html ?? '')) if (/^\d+$/.test(f.id)) wanted.add(Number(f.id));
  }
  const missing = [...wanted].filter((id) => !files.has(id));
  let looked = 0;
  await pool(missing, POOL, async (id) => {
    stopIfCancelled();
    try {
      files.set(id, await api.getFile(id));
    } catch (err) {
      warnings.push(`File ${id}: ${reasonOf(err)}`);
    }
    onProgress({ stage: 'finding-files', done: ++looked, total: missing.length });
  });
  if (courseFiles === null && files.size === 0 && wanted.size === 0) warnings.push('This course hides its Files area.');

  return { course, syllabusHtml: course.syllabus_body ?? null, modules, pages, assignments, files: [...files.values()], warnings };
}

/** Downloads files, pulls out their text and builds the zip (a JSZip object; `buildExportZip` makes the Blob). */
export async function packExport(
  api: ExportApi,
  scan: ScanResult,
  options: ExportOptions,
  onProgress: (p: ExportProgress) => void = () => {},
  signal?: AbortSignal,
  now = new Date(),
): Promise<{ zip: JSZip; summary: ExportSummary }> {
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  const infos: ExportFileInfo[] = scan.files.map((f) => ({ id: f.id, name: f.display_name || f.filename, size: f.size, contentType: f['content-type'] }));
  const originals = new Map<number, ArrayBuffer>();
  const needDownload = options.includeOriginals || options.extractText;

  if (needDownload) {
    let done = 0;
    await pool(scan.files, POOL, async (file, i) => {
      stopIfCancelled();
      const info = infos[i];
      onProgress({ stage: 'files', done, total: infos.length, name: info.name });
      try {
        if (file.size > options.maxFileBytes) {
          info.note = `too large to include (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
        } else {
          const bytes = await bytesOf(await api.downloadFile(file.url));
          if (options.includeOriginals) originals.set(file.id, bytes);
          if (options.extractText) {
            const text = await extractText(bytes, info.name, info.contentType);
            if (text) info.text = text;
            else if (!/^(image|video|audio)\//.test(info.contentType ?? '')) info.note = 'no text could be read from this file';
          }
        }
      } catch (err) {
        info.note = `could not be downloaded (${reasonOf(err)})`;
      }
      onProgress({ stage: 'files', done: ++done, total: infos.length, name: info.name });
    });
  }
  stopIfCancelled();

  // A file that failed has no original in the folder, so don't point at one.
  const usedPaths = new Set<string>();
  for (const info of infos) assignFilePaths(info, usedPaths, { original: originals.has(info.id) });

  onProgress({ stage: 'packing' });
  const docs = buildCourseExport({
    course: { id: scan.course.id, name: scan.course.name ?? `Course ${scan.course.id}`, code: scan.course.course_code, term: scan.course.term?.name },
    syllabusHtml: scan.syllabusHtml,
    modules: scan.modules,
    pages: scan.pages,
    assignments: scan.assignments,
    files: infos,
    generatedAt: now,
  });

  const root = `${slugify(scan.course.name ?? `course-${scan.course.id}`)}-ai-export`;
  const zip = new JSZip();
  for (const d of docs) zip.file(`${root}/${d.path}`, d.content);
  for (const info of infos) {
    const bytes = originals.get(info.id);
    if (bytes && info.path) zip.file(`${root}/${info.path}`, bytes);
  }

  const count = (kind: string) => docs.filter((d) => d.kind === kind).length;
  const summary: ExportSummary = {
    fileName: `${root}.zip`,
    documents: docs.length,
    units: count('unit'),
    pages: count('page'),
    assignments: count('assignment'),
    originals: originals.size,
    textFiles: count('file-text'),
    bytes: [...originals.values()].reduce((sum, b) => sum + b.byteLength, 0) + docs.reduce((sum, d) => sum + d.content.length, 0),
    notes: infos.filter((f) => f.note).map((f) => ({ name: f.name, note: f.note! })),
  };
  return { zip, summary };
}

export async function buildExportZip(
  api: ExportApi,
  scan: ScanResult,
  options: ExportOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; summary: ExportSummary }> {
  const { zip, summary } = await packExport(api, scan, options, onProgress, signal);
  stopCheck(signal);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
  return { blob, summary };
}

function stopCheck(signal?: AbortSignal) {
  if (signal?.aborted) throw new ExportCancelled();
}

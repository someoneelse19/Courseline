import JSZip from 'jszip';
import type { Assignment, AssignmentGroup, Course, CourseFile, Module, Page, Quiz, QuizQuestion, QuizSubmission, Submission } from '../api/types';
import { assignFilePaths, buildCourseExport, isImageFile, safeFileName, slugify, uniquePath, type ExportFileInfo, type ExportGrades } from './courseExport';
import { buildQuizResult, type QuizResult } from './quizResults';
import { extractText } from './extractText';
import { embeddedImages, linkedFiles } from './html';

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
  // Grades (only when the export includes them). Optional so a caller without them still exports the course.
  getCourse?(courseId: number): Promise<Course>;
  getAssignmentGroups?(courseId: number): Promise<AssignmentGroup[]>;
  getMySubmission?(courseId: number, assignmentId: number, opts?: { history?: boolean }): Promise<Submission>;
  getQuizzes?(courseId: number): Promise<Quiz[]>;
  getMyQuizSubmissions?(courseId: number, quizId: number): Promise<QuizSubmission[]>;
  getQuizQuestionsForAttempt?(courseId: number, quizId: number, quizSubmissionId: number, attempt: number): Promise<QuizQuestion[]>;
  getQuizSubmissionQuestions?(quizSubmissionId: number): Promise<QuizQuestion[]>;
}

export interface ScanResult {
  course: Course;
  syllabusHtml: string | null;
  modules: Module[];
  pages: Page[];
  assignments: Assignment[];
  files: CourseFile[];
  /** Course files shown as pictures inside the text (also in `files`). */
  imageFileIds: number[];
  /** Pictures inside the text that are not course files: outside links and pasted-in data: images. */
  otherImages: string[];
  /** Things that could not be read, in plain words (a hidden Pages tab, a file Canvas refused, …). */
  warnings: string[];
}

export interface ExportOptions {
  includeOriginals: boolean;
  extractText: boolean;
  maxFileBytes: number;
  /** Pictures: image files, and the images shown inside pages, assignments and the syllabus. */
  includeImages?: boolean;
  /** Your scores, status, teacher comments and rubric scores on every assignment, plus the course total. */
  includeGrades?: boolean;
  /** With includeGrades: which quiz questions you got right and wrong. */
  includeQuizResults?: boolean;
}

export type ExportProgress =
  | { stage: 'reading' }
  | { stage: 'finding-files'; done: number; total: number }
  | { stage: 'grades'; done: number; total: number }
  | { stage: 'quizzes'; done: number; total: number }
  | { stage: 'files'; done: number; total: number; name: string }
  | { stage: 'images'; done: number; total: number }
  | { stage: 'packing' };

export interface ExportSummary {
  fileName: string;
  documents: number;
  units: number;
  pages: number;
  assignments: number;
  originals: number;
  /** Pictures included (image files and other images). */
  images: number;
  textFiles: number;
  bytes: number;
  /** Files that are missing or only partly included, with the reason. */
  notes: { name: string; note: string }[];
  /** Whether grades went in, and what about them could not be read. */
  grades: boolean;
  gradeWarnings: string[];
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

export async function bytesOf(blob: Blob): Promise<ArrayBuffer> {
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
  const imageFileIds = new Set<number>();
  const otherImages = new Set<string>();
  for (const m of modules) for (const i of m.items ?? []) if (i.type === 'File' && i.content_id) wanted.add(i.content_id);
  for (const html of [course.syllabus_body, ...pages.map((p) => p.body), ...assignments.map((a) => a.description)]) {
    for (const f of linkedFiles(html ?? '')) if (/^\d+$/.test(f.id)) wanted.add(Number(f.id));
    for (const img of embeddedImages(html ?? '')) {
      if (img.fileId) {
        wanted.add(Number(img.fileId));
        imageFileIds.add(Number(img.fileId));
      } else if (/^(https?:|data:image\/)/i.test(img.src)) otherImages.add(img.src);
    }
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

  return {
    course,
    syllabusHtml: course.syllabus_body ?? null,
    modules,
    pages,
    assignments,
    files: [...files.values()],
    imageFileIds: [...imageFileIds].filter((id) => files.has(id)),
    otherImages: [...otherImages],
    warnings,
  };
}

/**
 * One classic quiz's latest finished attempt, question by question; null when the student has not finished it. The
 * questions come with their weights when Canvas allows it, else from the quiz submission; `history` is the quiz
 * assignment's submission_history (per-question right/wrong), when there is one. Throws only when the attempt list
 * itself cannot be read.
 */
export async function readQuizResult(api: ExportApi, courseId: number, quiz: Quiz, history: NonNullable<Submission['submission_history']>): Promise<QuizResult | null> {
  if (!api.getMyQuizSubmissions) return null;
  const subs = await api.getMyQuizSubmissions(courseId, quiz.id);
  const taken = subs.filter((s) => s.workflow_state === 'complete' || s.workflow_state === 'pending_review').sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0))[0];
  if (!taken) return null;
  // Neither questions call failing is an error worth reporting on its own: the history may be enough.
  let questions: QuizQuestion[] | null = null;
  if (api.getQuizQuestionsForAttempt && taken.attempt != null) questions = await api.getQuizQuestionsForAttempt(courseId, quiz.id, taken.id, taken.attempt).catch(() => null);
  if (!questions?.length && api.getQuizSubmissionQuestions) questions = await api.getQuizSubmissionQuestions(taken.id).catch(() => null);
  if (!questions?.length) questions = null;
  const attempt = history.find((h) => h.attempt === taken.attempt) ?? history[history.length - 1];
  return buildQuizResult({
    quizId: quiz.id,
    assignmentId: quiz.assignment_id ?? undefined,
    title: quiz.title,
    attempt: taken.attempt ?? undefined,
    score: taken.kept_score ?? taken.score,
    pointsPossible: taken.quiz_points_possible ?? quiz.points_possible,
    questions,
    data: attempt?.submission_data?.length ? attempt.submission_data : null,
  });
}

const isQuiz = (a: Assignment) => a.quiz_id != null || (a.submission_types ?? []).includes('online_quiz');

/**
 * Reads the student's own results: the gradebook groups and course total, each submission with its comments and
 * rubric scores, and (if asked) every classic quiz question by question. Every part is optional: what Canvas
 * refuses becomes a warning, so the export still has whatever could be read.
 */
export async function gatherGrades(
  api: ExportApi,
  scan: ScanResult,
  opts: { quizzes: boolean },
  onProgress: (p: ExportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<{ grades: ExportGrades; warnings: string[] }> {
  const courseId = scan.course.id;
  const warnings: string[] = [];
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new ExportCancelled();
  };
  const optional = async <T,>(what: string, run: (() => Promise<T>) | undefined, fallback: T): Promise<T> => {
    if (!run) return fallback;
    try {
      return await run();
    } catch (err) {
      warnings.push(`${what}: ${reasonOf(err)}`);
      return fallback;
    }
  };

  onProgress({ stage: 'grades', done: 0, total: scan.assignments.length });
  const [course, groups, quizzes] = await Promise.all([
    optional('Course total', api.getCourse && (() => api.getCourse!(courseId)), null as Course | null),
    optional('Assignment groups', api.getAssignmentGroups && (() => api.getAssignmentGroups!(courseId)), [] as AssignmentGroup[]),
    opts.quizzes ? optional('Quizzes', api.getQuizzes && (() => api.getQuizzes!(courseId)), [] as Quiz[]) : Promise.resolve([] as Quiz[]),
  ]);
  stopIfCancelled();

  // Each submission in full (comments, rubric scores; for a quiz also its attempts' per-question data). Only for
  // work that has something to show; the rest keeps what the assignment list already says.
  const quizAssignments = new Set(quizzes.map((q) => q.assignment_id).filter((id): id is number => id != null));
  const submissions = new Map<number, Submission>();
  const worthReading = scan.assignments.filter((a) => {
    const s = a.submission;
    return !s || s.workflow_state !== 'unsubmitted' || s.score != null || s.submitted_at != null || (s.submission_comments?.length ?? 0) > 0;
  });
  let done = 0;
  let failed = 0;
  let firstError = '';
  if (api.getMySubmission) {
    await pool(worthReading, POOL, async (a) => {
      stopIfCancelled();
      try {
        const wantHistory = opts.quizzes && (quizAssignments.has(a.id) || isQuiz(a));
        submissions.set(a.id, { ...a.submission, ...(await api.getMySubmission!(courseId, a.id, wantHistory ? { history: true } : undefined)) });
      } catch (err) {
        failed++;
        firstError ||= reasonOf(err);
      }
      onProgress({ stage: 'grades', done: ++done, total: worthReading.length });
    });
  }
  if (failed) warnings.push(`Feedback for ${failed} assignment(s) could not be read (${firstError}); their scores are still included.`);

  const results: QuizResult[] = [];
  if (opts.quizzes) {
    const graded = quizzes.filter((q) => q.quiz_type !== 'survey' && q.quiz_type !== 'graded_survey');
    let qDone = 0;
    await pool(graded, POOL, async (quiz) => {
      stopIfCancelled();
      onProgress({ stage: 'quizzes', done: qDone, total: graded.length });
      const history = quiz.assignment_id != null ? submissions.get(quiz.assignment_id)?.submission_history ?? [] : [];
      try {
        const result = await readQuizResult(api, courseId, quiz, history);
        if (result) results.push(result);
      } catch (err) {
        warnings.push(`Quiz "${quiz.title}": ${reasonOf(err)}`);
      }
      onProgress({ stage: 'quizzes', done: ++qDone, total: graded.length });
    });
    // In the course's own order, not the order the downloads finished.
    const position = new Map(quizzes.map((q, i) => [q.id, i]));
    results.sort((a, b) => (position.get(a.quizId) ?? 0) - (position.get(b.quizId) ?? 0));
  }
  stopIfCancelled();

  const enrollment = course?.enrollments?.find((e) => e.type === 'student') ?? course?.enrollments?.[0];
  const grades: ExportGrades = {
    total: enrollment ? { current: enrollment.computed_current_score, final: enrollment.computed_final_score, grade: enrollment.computed_current_grade } : undefined,
    groups,
    weighted: !!(course?.apply_assignment_group_weights ?? scan.course.apply_assignment_group_weights),
    submissions,
    quizzes: results,
  };
  return { grades, warnings };
}

const IMAGE_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp', 'image/avif': '.avif' };

/** The bytes and type of a `data:image/...;base64,` URL, or null if it is not one. */
export function decodeDataImage(src: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z0-9.+-]+)(;[^,]*)?,(.*)$/is.exec(src);
  if (!m) return null;
  try {
    if (/;base64/i.test(m[2] ?? '')) {
      const bin = atob(m[3].replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { type: m[1].toLowerCase(), bytes };
    }
    return { type: m[1].toLowerCase(), bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  } catch {
    return null;
  }
}

/** A file name for a picture that is not a course file: its own name when the URL has one, else image-N. */
function imageName(src: string, type: string, n: number): { base: string; ext: string } {
  const typeExt = IMAGE_EXT[type] ?? '';
  let last = '';
  try {
    if (!src.startsWith('data:')) last = decodeURIComponent(new URL(src).pathname.split('/').pop() ?? '');
  } catch {
    last = '';
  }
  const safe = last ? safeFileName(last) : '';
  const dot = safe.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot).toLowerCase()] : [safe, ''];
  return { base: slugify(base || `image-${n}`), ext: /^\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(ext) ? ext : typeExt || '.png' };
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
  const gathered = options.includeGrades ? await gatherGrades(api, scan, { quizzes: !!options.includeQuizResults }, onProgress, signal) : null;
  const originals = new Map<number, ArrayBuffer>();
  const imageIds = new Set(scan.imageFileIds ?? []);
  const isImage = (info: ExportFileInfo) => imageIds.has(info.id) || isImageFile(info);
  // A picture is kept as a file when images are wanted, even without "original files".
  const keepOriginal = (info: ExportFileInfo) => options.includeOriginals || (!!options.includeImages && isImage(info));
  const needDownload = (info: ExportFileInfo) => keepOriginal(info) || (options.extractText && !isImage(info));
  const toDownload = scan.files.map((f, i) => ({ file: f, info: infos[i] })).filter(({ info }) => needDownload(info));

  if (toDownload.length) {
    let done = 0;
    await pool(toDownload, POOL, async ({ file, info }) => {
      stopIfCancelled();
      onProgress({ stage: 'files', done, total: toDownload.length, name: info.name });
      try {
        if (file.size > options.maxFileBytes) {
          info.note = `too large to include (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
        } else {
          const bytes = await bytesOf(await api.downloadFile(file.url));
          if (keepOriginal(info)) originals.set(file.id, bytes);
          if (options.extractText && !isImage(info)) {
            const text = await extractText(bytes, info.name, info.contentType);
            if (text) info.text = text;
            else if (!/^(image|video|audio)\//.test(info.contentType ?? '')) info.note = 'no text could be read from this file';
          }
        }
      } catch (err) {
        info.note = `could not be downloaded (${reasonOf(err)})`;
      }
      onProgress({ stage: 'files', done: ++done, total: toDownload.length, name: info.name });
    });
  }
  stopIfCancelled();

  // Pictures that are not course files: decoded from the page itself, or fetched from their link. One that cannot be
  // fetched (many sites refuse other pages' downloads) keeps only its description.
  const usedPaths = new Set<string>();
  const imagePaths = new Map<string, string>();
  const imageBytes = new Map<string, ArrayBuffer | Uint8Array>();
  const others = options.includeImages ? scan.otherImages ?? [] : [];
  let imagesDone = 0;
  let imagesFailed = 0;
  await pool(others, POOL, async (src, i) => {
    stopIfCancelled();
    onProgress({ stage: 'images', done: imagesDone, total: others.length });
    try {
      let got: { type: string; bytes: ArrayBuffer | Uint8Array } | null = decodeDataImage(src);
      if (!got && !src.startsWith('data:')) {
        const blob = await api.downloadFile(src);
        got = { type: blob.type, bytes: await bytesOf(blob) };
      }
      if (got && (!got.type || got.type.startsWith('image/')) && got.bytes.byteLength <= options.maxFileBytes) {
        const { base, ext } = imageName(src, got.type, i + 1);
        const path = uniquePath('images', base, ext, usedPaths);
        imagePaths.set(src, path);
        imageBytes.set(path, got.bytes);
      } else imagesFailed++;
    } catch {
      imagesFailed++;
    }
    onProgress({ stage: 'images', done: ++imagesDone, total: others.length });
  });
  stopIfCancelled();

  // A file that failed has no original in the folder, so don't point at one.
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
    images: options.includeImages ? imagePaths : undefined,
    grades: gathered?.grades,
  });

  const root = `${slugify(scan.course.name ?? `course-${scan.course.id}`)}-ai-export`;
  const zip = new JSZip();
  for (const d of docs) zip.file(`${root}/${d.path}`, d.content);
  for (const info of infos) {
    const bytes = originals.get(info.id);
    if (bytes && info.path) zip.file(`${root}/${info.path}`, bytes);
  }
  for (const [path, bytes] of imageBytes) zip.file(`${root}/${path}`, bytes);

  const count = (kind: string) => docs.filter((d) => d.kind === kind).length;
  const summary: ExportSummary = {
    fileName: `${root}.zip`,
    documents: docs.length,
    units: count('unit'),
    pages: count('page'),
    assignments: count('assignment'),
    originals: originals.size,
    images: infos.filter((f) => f.path && isImage(f)).length + imageBytes.size,
    textFiles: count('file-text'),
    bytes: [...originals.values(), ...imageBytes.values()].reduce((sum, b) => sum + b.byteLength, 0) + docs.reduce((sum, d) => sum + d.content.length, 0),
    notes: [
      ...infos.filter((f) => f.note).map((f) => ({ name: f.name, note: f.note! })),
      ...(imagesFailed ? [{ name: `${imagesFailed} image(s) from outside Canvas`, note: 'could not be downloaded; only their descriptions are included' }] : []),
    ],
    grades: !!gathered,
    gradeWarnings: gathered?.warnings ?? [],
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

import type { CanvasApi } from '../api/canvas';
import type { Assignment, Course, CourseFile, Page } from '../api/types';
import { buildCourseExport, isImageFile, scoreText, statusText } from '../lib/courseExport';
import { bytesOf, gatherGrades, readQuizResult, type ScanResult } from '../lib/courseExportRunner';
import { htmlToMarkdown } from '../lib/htmlToMarkdown';

// The tools the Courseline connector gives Claude (in the Claude desktop app, over MCP): read-only views of the
// student's Canvas, as Markdown. Each tool is a name, a description Claude reads to decide when to call it, a JSON
// schema for its arguments, and a function. Nothing here writes to Canvas.

export interface ToolContext {
  api: CanvasApi;
  /** Text out of a downloaded file (lib/extractText in the real connector; a stub in tests). */
  readText: (bytes: ArrayBuffer, name: string, contentType?: string) => Promise<string | null>;
  now?: () => Date;
  /** Shared between calls so a conversation does not fetch the same thing twice (see makeCache). */
  cache?: Cache;
}

export type ToolOutput = { text: string; image?: { data: string; mimeType: string } };

export interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
}

/** A mistake in what Claude asked for (unknown course, missing argument). Its message is shown to Claude as is. */
export class ToolInputError extends Error {}

// ---------- cache ----------

export interface Cache {
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
}

/** Remembers results for `ttlMs`; a failed load is forgotten at once so the next call tries again. */
export function makeCache(ttlMs = 5 * 60_000, clock: () => number = Date.now): Cache {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  return {
    get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && clock() - hit.at < ttlMs) return hit.value as Promise<T>;
      const value = load();
      entries.set(key, { at: clock(), value });
      value.catch(() => entries.delete(key));
      return value;
    },
  };
}

const noCache: Cache = { get: (_key, load) => load() };
const cached = <T,>(ctx: ToolContext, key: string, load: () => Promise<T>) => (ctx.cache ?? noCache).get(key, load);

// ---------- helpers ----------

const MAX_OUTPUT = 100_000; // characters per answer; more is cut with a note
const FILE_CHUNK = 60_000; // read_file pages long files in pieces this size
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function clip(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n\n[Cut here: the answer is longer than ${MAX_OUTPUT.toLocaleString('en')} characters.]` : text;
}

/** Lowercase, accents removed, for matching what the student typed against Canvas names. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "Wed 12 Nov 2026, 23:59 CET", in the computer's own time zone; "no due date" when there is none. */
export function when(iso: string | null | undefined): string {
  if (!iso) return 'no due date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

const reasonOf = (err: unknown) => (err instanceof Error && err.message ? err.message : 'unknown error');
const cell = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');

/** Turns Canvas file links and pictures into something Claude can follow with read_file. */
const toMarkdown = (html: string | null | undefined) =>
  htmlToMarkdown(html, {
    rewriteHref: (href) => {
      const file = href.match(/\/files\/(\d+)/);
      return file ? `file:${file[1]}` : href;
    },
    rewriteImage: (src) => {
      const file = src.match(/\/files\/(\d+)/);
      return file ? `file:${file[1]}` : /^https?:/.test(src) ? src : null;
    },
  });

function gradeOf(c: Course): string {
  const e = c.enrollments?.find((x) => x.type === 'student') ?? c.enrollments?.[0];
  if (!e) return '';
  const pct = e.computed_current_score != null ? `${Math.round(e.computed_current_score * 100) / 100}%` : '';
  return [pct, e.computed_current_grade ? `(${e.computed_current_grade})` : ''].filter(Boolean).join(' ');
}

const courses = (ctx: ToolContext) => cached(ctx, 'courses', () => ctx.api.getCourses());

/** A course from its id, or from (part of) its name or code. */
export async function resolveCourse(ctx: ToolContext, ref: unknown): Promise<Course> {
  if (ref === undefined || ref === null || String(ref).trim() === '') throw new ToolInputError('Say which course: its id or part of its name (list_courses shows them).');
  const all = await courses(ctx);
  const text = String(ref).trim();
  if (/^\d+$/.test(text)) {
    const id = Number(text);
    const found = all.find((c) => c.id === id);
    if (found) return found;
    // Not among the active ones (a past course): ask Canvas directly.
    return cached(ctx, `course:${id}`, () => ctx.api.getCourse(id));
  }
  const q = fold(text);
  const exact = all.filter((c) => fold(c.name ?? '') === q || fold(c.course_code ?? '') === q);
  if (exact.length === 1) return exact[0];
  const words = q.split(/\s+/).filter(Boolean);
  const matches = all.filter((c) => words.every((w) => fold(`${c.name ?? ''} ${c.course_code ?? ''}`).includes(w)));
  if (matches.length === 1) return matches[0];
  const list = (cs: Course[]) => cs.map((c) => `- ${c.name} (id ${c.id})`).join('\n');
  if (!matches.length) throw new ToolInputError(`No course matches "${text}". The courses are:\n${list(all)}`);
  throw new ToolInputError(`"${text}" matches more than one course; use its id:\n${list(matches)}`);
}

const assignments = (ctx: ToolContext, courseId: number) => cached(ctx, `assignments:${courseId}`, () => ctx.api.getAssignments(courseId));
const pages = (ctx: ToolContext, courseId: number) => cached(ctx, `pages:${courseId}`, () => ctx.api.getPages(courseId, () => modules(ctx, courseId)));
const modules = (ctx: ToolContext, courseId: number) => cached(ctx, `modules:${courseId}`, () => ctx.api.getModules(courseId));
const syllabus = (ctx: ToolContext, courseId: number) => cached(ctx, `syllabus:${courseId}`, () => ctx.api.getCourseSyllabus(courseId));

/** Removes the export's links between its own files (they mean nothing in a chat), keeping the text, plus the id. */
function relink(md: string, labels: Map<string, string>): string {
  return md.replace(/\[([^\]]+)\]\(((?:\.\.\/)?(?:assignments|pages|files|images|units|files-text)\/[^)]+)\)/g, (_m, text: string, path: string) => labels.get(path.replace(/^\.\.\//, '')) ?? text);
}

const num = (args: Record<string, unknown>, key: string): number => {
  const v = Number(args[key]);
  if (!Number.isInteger(v) || v <= 0) throw new ToolInputError(`"${key}" must be a Canvas id (a whole number).`);
  return v;
};

// ---------- the tools ----------

const courseArg = { course: { type: ['string', 'integer'], description: 'The course: its id, or part of its name or code (e.g. "calculo").' } };

export const tools: Tool[] = [
  {
    name: 'list_courses',
    description: "The student's current Canvas courses: name, id, code, term and current grade. Start here to find a course's id.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_args, ctx) => {
      const all = await courses(ctx);
      if (!all.length) return { text: 'No active courses.' };
      const lines = all.map((c) => {
        const grade = gradeOf(c);
        return `- **${c.name}** (id ${c.id}${c.course_code ? `, ${c.course_code}` : ''}${c.term?.name ? `, ${c.term.name}` : ''})${grade ? `: current grade ${grade}` : ''}`;
      });
      return { text: `# Your courses\n\n${lines.join('\n')}` };
    },
  },

  {
    name: 'get_upcoming',
    description: 'Assignments due soon across all courses (what Canvas lists as upcoming), with due dates and whether they are submitted.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (_args, ctx) => {
      const [events, all] = await Promise.all([cached(ctx, 'upcoming', () => ctx.api.getUpcoming()), courses(ctx)]);
      if (!events.length) return { text: 'Nothing upcoming in Canvas.' };
      const name = new Map(all.map((c) => [`course_${c.id}`, c.name ?? `Course ${c.id}`]));
      const now = ctx.now?.() ?? new Date();
      const rows = events.map((e) => {
        const a = e.assignment!;
        return `| ${cell(a.name)} | ${cell(name.get(e.context_code ?? '') ?? '')} | ${when(a.due_at ?? e.start_at)} | ${a.points_possible ?? ''} | ${statusText(a, a.submission, now)} | ${a.id} |`;
      });
      return { text: ['# Upcoming', '', '| Assignment | Course | Due | Points | Status | assignment_id |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n') };
    },
  },

  {
    name: 'get_course_outline',
    description: "A course's syllabus and its units (modules) in order, listing every item with the id to open it (assignment_id, page, file_id). Use this to see what a course covers.",
    inputSchema: { type: 'object', properties: courseArg, required: ['course'], additionalProperties: false },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const [syl, mods] = await Promise.allSettled([syllabus(ctx, course.id), modules(ctx, course.id)]);
      const out = [`# ${course.name}`, '', [course.course_code, course.term?.name, gradeOf(course) && `current grade ${gradeOf(course)}`].filter(Boolean).join(' · '), ''];
      if (syl.status === 'fulfilled' && syl.value.syllabus_body) out.push('## Syllabus', '', toMarkdown(syl.value.syllabus_body), '');
      else out.push(`_Syllabus: ${syl.status === 'rejected' ? reasonOf(syl.reason) : 'empty'}._`, '');
      if (mods.status === 'rejected') out.push(`_Units: ${reasonOf(mods.reason)}._`);
      else if (!mods.value.length) out.push('_This course has no units._');
      else {
        mods.value.forEach((m, i) => {
          out.push(`## Unit ${i + 1}: ${m.name}`, '');
          for (const item of m.items ?? []) {
            const indent = '  '.repeat(item.indent ?? 0);
            const ref =
              item.type === 'Assignment' || item.type === 'Quiz' || item.type === 'Discussion'
                ? item.type === 'Assignment' && item.content_id ? ` (assignment_id ${item.content_id})` : item.content_id ? ` (${item.type.toLowerCase()} id ${item.content_id})` : ''
                : item.type === 'Page' && item.page_url ? ` (page "${item.page_url}")`
                : item.type === 'File' && item.content_id ? ` (file_id ${item.content_id})`
                : item.type === 'ExternalUrl' && item.external_url ? ` (${item.external_url})`
                : '';
            const due = item.content_details?.due_at ? `, due ${when(item.content_details.due_at)}` : '';
            out.push(item.type === 'SubHeader' ? `${indent}- **${item.title}**` : `${indent}- ${item.type}: ${item.title}${ref}${due}`);
          }
          out.push('');
        });
      }
      return { text: clip(out.join('\n').trim()) };
    },
  },

  {
    name: 'list_assignments',
    description: "A course's assignments with id, due date, points, the student's status and score. `which` narrows to upcoming (not yet due), past (already due) or all.",
    inputSchema: {
      type: 'object',
      properties: { ...courseArg, which: { type: 'string', enum: ['all', 'upcoming', 'past'], description: 'Default: all.' } },
      required: ['course'],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const now = ctx.now?.() ?? new Date();
      const which = args.which === 'upcoming' || args.which === 'past' ? args.which : 'all';
      let list = await assignments(ctx, course.id);
      const due = (a: Assignment) => (a.due_at ? new Date(a.due_at).getTime() : Infinity);
      if (which === 'upcoming') list = list.filter((a) => due(a) >= now.getTime()).sort((a, b) => due(a) - due(b));
      if (which === 'past') list = list.filter((a) => due(a) < now.getTime()).sort((a, b) => due(b) - due(a));
      if (!list.length) return { text: `No ${which === 'all' ? '' : `${which} `}assignments in ${course.name}.` };
      const rows = list.map((a) => {
        const s = a.submission;
        const score = s?.excused ? 'excused' : scoreText(s?.score, a.points_possible) || s?.grade || '–';
        return `| ${a.id} | ${cell(a.name)} | ${when(a.due_at)} | ${a.points_possible ?? ''} | ${statusText(a, s, now)} | ${score} |`;
      });
      return { text: clip([`# ${course.name}: ${which} assignments`, '', '| assignment_id | Name | Due | Points | Status | Score |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n')) };
    },
  },

  {
    name: 'get_assignment',
    description:
      "One assignment in full: instructions, rubric, and the student's result (score, status, teacher comments, rubric scores, what they handed in). For a classic quiz it also lists each question, the student's answer and whether it was right or wrong, as far as Canvas shows that.",
    inputSchema: {
      type: 'object',
      properties: { ...courseArg, assignment_id: { type: 'integer', description: 'From list_assignments, get_upcoming or get_course_outline.' } },
      required: ['course', 'assignment_id'],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const id = num(args, 'assignment_id');
      const a = await cached(ctx, `assignment:${course.id}:${id}`, () => ctx.api.getAssignment(course.id, id));
      const isQuiz = a.quiz_id != null || (a.submission_types ?? []).includes('online_quiz');
      const notes: string[] = [];
      const sub = await cached(ctx, `submission:${course.id}:${id}`, () => ctx.api.getMySubmission(course.id, id, isQuiz ? { history: true } : undefined)).catch((err) => {
        notes.push(`Your submission details could not be read: ${reasonOf(err)}.`);
        return a.submission;
      });
      let quiz = null;
      if (a.quiz_id != null) {
        quiz = await readQuizResult(ctx.api, course.id, { id: a.quiz_id, title: a.name, assignment_id: a.id, points_possible: a.points_possible }, sub?.submission_history ?? []).catch((err) => {
          notes.push(`The quiz questions could not be read: ${reasonOf(err)}.`);
          return null;
        });
        if (!quiz && !notes.length) notes.push('No finished quiz attempt, so there are no answers to show.');
      }
      const docs = buildCourseExport({
        course: { id: course.id, name: course.name ?? `Course ${course.id}` },
        syllabusHtml: null,
        modules: [],
        pages: [],
        assignments: [a],
        files: [],
        generatedAt: ctx.now?.() ?? new Date(),
        grades: { groups: [], weighted: false, submissions: new Map(sub ? [[a.id, sub]] : []), quizzes: quiz ? [quiz] : [] },
      });
      const doc = docs.find((d) => d.kind === 'assignment')?.content ?? '';
      return { text: clip([doc.trim(), ...notes.map((n) => `\n_${n}_`)].join('\n')) };
    },
  },

  {
    name: 'get_grades',
    description:
      "The student's grades in a course: Canvas's course total, each assignment group with its weight, and every assignment's score, status and class median. Set include_quiz_results to also count right/wrong answers on every quiz (slower).",
    inputSchema: {
      type: 'object',
      properties: { ...courseArg, include_quiz_results: { type: 'boolean', description: 'Default: false.' } },
      required: ['course'],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const list = await assignments(ctx, course.id).catch(() => [] as Assignment[]);
      const scan: ScanResult = { course, syllabusHtml: null, modules: [], pages: [], assignments: list, files: [], imageFileIds: [], otherImages: [], warnings: [] };
      const quizzes = args.include_quiz_results === true;
      const { grades, warnings } = await cached(ctx, `grades:${course.id}:${quizzes}`, () => gatherGrades(ctx.api, scan, { quizzes }));
      const docs = buildCourseExport({ course: { id: course.id, name: course.name ?? `Course ${course.id}` }, syllabusHtml: null, modules: [], pages: [], assignments: list, files: [], generatedAt: ctx.now?.() ?? new Date(), grades });
      const labels = new Map<string, string>();
      const assignmentDocs = docs.filter((d) => d.kind === 'assignment');
      assignmentDocs.forEach((d, i) => labels.set(d.path, `${list[i].name} (id ${list[i].id})`));
      const text = relink(docs.find((d) => d.kind === 'grades')?.content ?? '', labels);
      return { text: clip([text.trim(), ...(warnings.length ? ['', '_Could not read: ' + warnings.join('; ') + '_'] : [])].join('\n')) };
    },
  },

  {
    name: 'list_pages',
    description: "A course's content pages (titles and the `page` value to open each with read_page).",
    inputSchema: { type: 'object', properties: courseArg, required: ['course'], additionalProperties: false },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const list = await pages(ctx, course.id);
      if (!list.length) return { text: `${course.name} has no pages Canvas lets you see.` };
      return { text: clip([`# ${course.name}: pages`, '', ...list.map((p) => `- ${p.title ?? p.url}${p.front_page ? ' (home page)' : ''} (page "${p.url}")`)].join('\n')) };
    },
  },

  {
    name: 'read_page',
    description: 'One content page as text. `page` is its slug from list_pages or get_course_outline, or its title. Links like file:123 and images like ![…](file:123) can be opened with read_file.',
    inputSchema: {
      type: 'object',
      properties: { ...courseArg, page: { type: 'string', description: 'The page slug (e.g. "unit-2-limits") or title.' } },
      required: ['course', 'page'],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const ref = String(args.page ?? '').trim();
      if (!ref) throw new ToolInputError('Say which page (its slug or title).');
      const list = await pages(ctx, course.id).catch(() => [] as Page[]);
      const page = list.find((p) => p.url === ref) ?? list.find((p) => fold(p.title ?? '') === fold(ref)) ?? (await cached(ctx, `page:${course.id}:${ref}`, () => ctx.api.getPage(course.id, ref)));
      return { text: clip(`# ${page.title ?? page.url}\n\n${toMarkdown(page.body) || '(This page is empty.)'}`) };
    },
  },

  {
    name: 'list_files',
    description: "A course's files (slides, readings, handouts) with their file_id, size and type. Open one with read_file.",
    inputSchema: { type: 'object', properties: courseArg, required: ['course'], additionalProperties: false },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const files = await cached(ctx, `files:${course.id}`, () => ctx.api.getCourseFiles(course.id)).catch(() => null);
      const lines: string[] = [];
      if (files?.length) {
        for (const f of [...files].sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''))) lines.push(`- ${f.display_name} (file_id ${f.id}, ${sizeText(f.size)}${f['content-type'] ? `, ${f['content-type']}` : ''})`);
      } else {
        // The Files area is hidden: the files the units point at are still reachable.
        const mods = await modules(ctx, course.id).catch(() => []);
        for (const m of mods) for (const i of m.items ?? []) if (i.type === 'File' && i.content_id) lines.push(`- ${i.title} (file_id ${i.content_id}, in unit "${m.name}")`);
        if (lines.length) lines.unshift('_The Files area is hidden in this course; these are the files its units link to._', '');
      }
      if (!lines.length) return { text: `No files Canvas lets you see in ${course.name}.` };
      return { text: clip([`# ${course.name}: files`, '', ...lines].join('\n')) };
    },
  },

  {
    name: 'read_file',
    description: `A course file's content. PDFs, Word, PowerPoint (with speaker notes), Excel and text files come back as text, ${FILE_CHUNK.toLocaleString('en')} characters at a time: call again with \`start\` to read on. Images come back as the picture itself.`,
    inputSchema: {
      type: 'object',
      properties: {
        file_id: { type: 'integer', description: 'From list_files, get_course_outline, or a file:123 link in a page or assignment.' },
        start: { type: 'integer', description: 'Character to start from, for long files. Default 0.' },
      },
      required: ['file_id'],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const id = num(args, 'file_id');
      const file: CourseFile = await cached(ctx, `file:${id}`, () => ctx.api.getFile(id));
      const name = file.display_name || file.filename;
      const info = { name, contentType: file['content-type'] };
      if (file.size > MAX_FILE_BYTES) return { text: `${name} is too large to read here (${sizeText(file.size)}).` };
      if (isImageFile(info)) {
        if (file.size > MAX_IMAGE_BYTES) return { text: `${name} is an image too large to show here (${sizeText(file.size)}).` };
        const bytes = await bytesOf(await ctx.api.downloadFile(file.url));
        return { text: name, image: { data: Buffer.from(bytes).toString('base64'), mimeType: file['content-type'] || 'image/png' } };
      }
      const text = await cached(ctx, `filetext:${id}`, async () => ctx.readText(await bytesOf(await ctx.api.downloadFile(file.url)), name, file['content-type']));
      if (!text) return { text: `No text could be read from ${name} (it may be a scan, or a type that has no text).` };
      const start = Math.max(0, Math.floor(Number(args.start) || 0));
      if (start >= text.length) return { text: `${name} has only ${text.length.toLocaleString('en')} characters.` };
      const end = Math.min(text.length, start + FILE_CHUNK);
      const more = end < text.length ? `\n\n[Characters ${start.toLocaleString('en')}–${end.toLocaleString('en')} of ${text.length.toLocaleString('en')}. Call read_file with start=${end} to read on.]` : '';
      return { text: `# ${name}\n\n${text.slice(start, end)}${more}` };
    },
  },

  {
    name: 'list_announcements',
    description: "A course's announcements, newest first, with their text.",
    inputSchema: {
      type: 'object',
      properties: { ...courseArg, limit: { type: 'integer', description: 'How many, newest first. Default 10.' } },
      required: ['course'],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit) || 10)));
      const list = (await cached(ctx, `announcements:${course.id}`, () => ctx.api.getAnnouncements(course.id))).slice(0, limit);
      if (!list.length) return { text: `No announcements in ${course.name}.` };
      const parts = list.map((t) => {
        const body = toMarkdown(t.message);
        return `## ${t.title}\n\n${when(t.posted_at)}${t.author?.display_name ? ` · ${t.author.display_name}` : ''}\n\n${body.length > 3000 ? `${body.slice(0, 3000)}…` : body}`;
      });
      return { text: clip([`# ${course.name}: announcements`, ...parts].join('\n\n')) };
    },
  },

  {
    name: 'search_course',
    description: "Finds where a course talks about something: searches the syllabus, every page and every assignment's instructions for all the words given, and returns the best matches with a snippet and how to open each. Files are not searched (use read_file).",
    inputSchema: {
      type: 'object',
      properties: { ...courseArg, query: { type: 'string', description: 'Words to look for, e.g. "chain rule".' } },
      required: ['course', 'query'],
      additionalProperties: false,
    },
    run: async (args, ctx) => {
      const course = await resolveCourse(ctx, args.course);
      const words = fold(String(args.query ?? '')).split(/\s+/).filter((w) => w.length > 1);
      if (!words.length) throw new ToolInputError('Give some words to search for.');
      const [syl, pageList, assignmentList] = await Promise.all([
        syllabus(ctx, course.id).catch(() => null),
        pages(ctx, course.id).catch(() => [] as Page[]),
        assignments(ctx, course.id).catch(() => [] as Assignment[]),
      ]);
      const sources = [
        ...(syl?.syllabus_body ? [{ where: 'Syllabus (get_course_outline)', html: syl.syllabus_body }] : []),
        ...pageList.map((p) => ({ where: `Page "${p.title ?? p.url}" (read_page "${p.url}")`, html: p.body ?? '' })),
        ...assignmentList.map((a) => ({ where: `Assignment "${a.name}" (get_assignment ${a.id})`, html: `<p>${a.name}</p>${a.description ?? ''}` })),
      ];
      const hits = sources
        .map((s) => {
          const text = toMarkdown(s.html).replace(/\s+/g, ' ');
          const folded = fold(text);
          if (!words.every((w) => folded.includes(w))) return null;
          const count = words.reduce((n, w) => n + folded.split(w).length - 1, 0);
          const at = folded.indexOf(words[0]);
          const snippet = `${at > 150 ? '…' : ''}${text.slice(Math.max(0, at - 150), at + 250).trim()}${at + 250 < text.length ? '…' : ''}`;
          return { where: s.where, count, snippet };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null)
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
      if (!hits.length) return { text: `Nothing in ${course.name}'s syllabus, pages or assignments mentions "${args.query}". It may be inside a file (list_files, read_file).` };
      return { text: clip([`# "${args.query}" in ${course.name}`, '', ...hits.map((h) => `- **${h.where}**: ${h.snippet}`)].join('\n')) };
    },
  },
];

function sizeText(bytes: number | undefined): string {
  if (bytes == null) return 'size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

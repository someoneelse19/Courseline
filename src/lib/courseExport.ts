import type { Assignment, AssignmentGroup, Module, ModuleItem, Page, RubricCriterion, ScoreStatistics, Submission } from '../api/types';
import { computeGrade, toModel } from './grades';
import { htmlToMarkdown } from './htmlToMarkdown';
import { outcomeLabel, tally, type QuizResult } from './quizResults';

// Builds the contents of the "AI export": a folder of Markdown a language model can read to teach
// the course. Pure (no network, no DOM beyond htmlToMarkdown), so it is easy to test; the fetching
// and zipping live in courseExportRunner.ts.
//
//   README.md        how to use the folder with an AI + a map of everything in it
//   ALL_TEXT.md      all the text in one file (paste into a chat, or give to a tool that takes one file)
//   syllabus.md
//   units/NN-*.md    each unit (module) in the instructor's order, with its pages and assignments inline
//   pages/*.md       every wiki page
//   assignments/*.md every assignment: instructions, due date, points, rubric
//   files/*          the original files (optional)
//   files-text/*.md  text pulled out of those files (PDF, Word, PowerPoint, Excel, text, code)
//   grades.md        (optional) the student's scores, the course total, and quiz results; each assignment
//                    then also gets a "Your result" part (score, feedback, rubric, which questions were wrong)
//   manifest.json    the same map, for programs

export interface ExportFileInfo {
  id: number;
  name: string;
  size: number;
  contentType?: string;
  /** Where the original sits in the folder, if it was included. */
  path?: string;
  /** Where its extracted text sits, and the text. */
  textPath?: string;
  text?: string;
  /** Why the file is missing or only partly there (too big, download failed, no text found, …). */
  note?: string;
}

export interface ExportInput {
  course: { id: number; name: string; code?: string; term?: string };
  syllabusHtml: string | null;
  modules: Module[];
  pages: Page[];
  assignments: Assignment[];
  files: ExportFileInfo[];
  generatedAt: Date;
  /**
   * Set when the export includes images: where each picture that is not a Canvas file (an outside link, a pasted-in
   * data: image) was saved, by its src. Canvas-file pictures use their file's path.
   */
  images?: Map<string, string>;
  /** The student's own results; leaving it out keeps the export free of grades. */
  grades?: ExportGrades;
}

export interface ExportGrades {
  /** Canvas's own course total, when it shows one. */
  total?: { current?: number | null; final?: number | null; grade?: string | null };
  /** The gradebook groups (weights, drop rules, class statistics); may be empty. */
  groups: AssignmentGroup[];
  weighted: boolean;
  /** The student's submission per assignment id, with teacher comments and rubric scores when Canvas gave them. */
  submissions: Map<number, Submission>;
  /** Question-by-question quiz results, when asked for. */
  quizzes: QuizResult[];
}

export interface ExportDoc {
  path: string;
  title: string;
  kind: 'readme' | 'all' | 'syllabus' | 'grades' | 'unit' | 'page' | 'assignment' | 'file-text' | 'manifest';
  content: string;
}

// ---------- names and paths ----------

/** Lowercase, accent-free, dash-separated; never empty. */
export function slugify(text: string, max = 60): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
  return s || 'untitled';
}

/** Keeps a file's own name but removes what zip tools and file systems dislike. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 120) || 'file';
}

/** `name.ext`, or `name-2.ext`, `name-3.ext`… when `used` already has it. Adds the result to `used`. */
export function uniquePath(dir: string, base: string, ext: string, used: Set<string>): string {
  let n = 1;
  let path = `${dir}/${base}${ext}`;
  while (used.has(path.toLowerCase())) path = `${dir}/${base}-${++n}${ext}`;
  used.add(path.toLowerCase());
  return path;
}

/** A picture, by its type or, failing that, its name. */
export function isImageFile(f: { name: string; contentType?: string }): boolean {
  return /^image\//.test(f.contentType ?? '') || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name);
}

/** Gives a file its folder path (`files/…`) and, when it has text, its text path (`files-text/…`). */
export function assignFilePaths(file: ExportFileInfo, used: Set<string>, opts: { original: boolean }): void {
  const safe = safeFileName(file.name);
  const dot = safe.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ''];
  if (opts.original) file.path = uniquePath('files', base, ext, used);
  if (file.text) file.textPath = uniquePath('files-text', base, '.md', used);
}

// ---------- Markdown pieces ----------

const heading = (level: number, text: string) => `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${text}`;

function rubricMarkdown(criteria: RubricCriterion[], level: number): string {
  const lines = [heading(level, 'Rubric'), ''];
  for (const c of criteria) {
    lines.push(`- **${c.description}** (${c.points} pts)${c.long_description ? `: ${c.long_description.replace(/\s+/g, ' ')}` : ''}`);
    for (const r of c.ratings) lines.push(`  - ${r.points} pts, ${r.description}${r.long_description ? `: ${r.long_description.replace(/\s+/g, ' ')}` : ''}`);
  }
  return lines.join('\n');
}

// ---------- grades ----------

/** 8.5, 10, 0.33: at most two decimals, no trailing zeros. */
export const num = (n: number) => String(Math.round(n * 100) / 100);
const pct = (n: number | null | undefined) => (n == null ? '' : `${num(n)}%`);

/** "8 / 10 (80%)", "8", or "" when there is no score. */
export function scoreText(score: number | null | undefined, outOf: number | null | undefined): string {
  if (score == null) return '';
  if (outOf == null || outOf <= 0) return num(score);
  return `${num(score)} / ${num(outOf)} (${pct((score / outOf) * 100)})`;
}

/** Where the work stands, in plain words. */
export function statusText(a: Assignment, s: Submission | undefined, now: Date): string {
  if (!s) return 'no submission recorded';
  if (s.excused) return 'excused';
  const late = s.late ? ', late' : '';
  if (s.missing) return 'missing';
  if (s.score != null || s.workflow_state === 'graded') return s.score == null && !s.grade ? `submitted${late}, not graded yet` : `graded${late}`;
  if (s.workflow_state === 'pending_review') return `submitted${late}, waiting for review`;
  if (s.workflow_state === 'submitted' || s.submitted_at) return `submitted${late}, not graded yet`;
  return a.due_at && new Date(a.due_at) < now ? 'not submitted' : 'not submitted yet';
}

function statsText(st: ScoreStatistics): string {
  return [`low ${num(st.min)}`, st.lower_q != null ? `25% ${num(st.lower_q)}` : '', `median ${num(st.median)}`, st.upper_q != null ? `75% ${num(st.upper_q)}` : '', `high ${num(st.max)}`, `mean ${num(st.mean)}`]
    .filter(Boolean)
    .join(', ');
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const cell = (s: string) => oneLine(s).replace(/\|/g, '\\|');

export function quizResultMarkdown(r: QuizResult, level: number): string {
  const lines = [heading(level, `Question by question${r.attempt ? ` (attempt ${r.attempt})` : ''}`), ''];
  const summary = tally(r);
  if (summary) lines.push(`**${summary}.**`, '');
  if (r.note) lines.push(`_${r.note}_`, '');
  for (const q of r.questions) {
    const pts = q.points != null || q.pointsPossible != null ? ` (${q.points != null ? num(q.points) : '?'}${q.pointsPossible != null ? ` / ${num(q.pointsPossible)}` : ''} pts)` : '';
    lines.push(`${q.number}. ${outcomeLabel[q.outcome]}${pts}${q.name ? `: **${oneLine(q.name)}**` : ''}`);
    if (q.text) lines.push('', ...q.text.split('\n').map((l) => (l ? `   ${l}` : '')), '');
    if (q.yourAnswer) lines.push(`   - Your answer: ${oneLine(q.yourAnswer)}`);
    if (q.correctAnswer) lines.push(`   - Right answer: ${oneLine(q.correctAnswer)}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function buildCourseExport(input: ExportInput): ExportDoc[] {
  const { course, modules, pages, assignments, files } = input;
  const used = new Set<string>();
  const docs: ExportDoc[] = [];

  // Stable paths for pages and assignments, decided up front so any document can link to any other.
  const pagePath = new Map<string, string>(); // page slug (Page.url) → path
  for (const p of pages) pagePath.set(p.url ?? String(p.page_id), uniquePath('pages', slugify(p.title ?? p.url ?? 'page'), '.md', used));
  const assignmentPath = new Map<number, string>();
  for (const a of assignments) assignmentPath.set(a.id, uniquePath('assignments', slugify(a.name), '.md', used));
  const fileById = new Map(files.map((f) => [f.id, f]));
  const { grades } = input;
  const statsById = new Map<number, ScoreStatistics>();
  for (const g of grades?.groups ?? []) for (const a of g.assignments ?? []) if (a.score_statistics) statsById.set(a.id, a.score_statistics);
  for (const a of assignments) if (a.score_statistics) statsById.set(a.id, a.score_statistics);
  const quizByAssignment = new Map((grades?.quizzes ?? []).filter((q) => q.assignmentId != null).map((q) => [q.assignmentId!, q]));
  const assignmentByQuiz = new Map(assignments.filter((a) => a.quiz_id != null).map((a) => [a.quiz_id!, a]));
  const quizById = new Map((grades?.quizzes ?? []).map((q) => [q.quizId, q]));
  const submissionOf = (a: Assignment) => grades?.submissions.get(a.id) ?? a.submission;
  const pageBySlug = new Map(pages.map((p) => [p.url ?? String(p.page_id), p]));
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));

  /** Rewrites Canvas links to the exported copies. `prefix` climbs out of the document's folder. */
  const rewriter = (prefix: string) => (href: string) => {
    const file = href.match(/\/files\/(\d+)/);
    if (file) {
      const f = fileById.get(Number(file[1]));
      const target = f?.path ?? f?.textPath;
      if (target) return prefix + target;
    }
    const page = href.match(/\/courses\/\d+\/pages\/([^/?#]+)/);
    if (page) {
      const target = pagePath.get(decodeURIComponent(page[1]));
      if (target) return prefix + target;
    }
    const assignment = href.match(/\/courses\/\d+\/assignments\/(\d+)/);
    if (assignment) {
      const target = assignmentPath.get(Number(assignment[1]));
      if (target) return prefix + target;
    }
    return href;
  };

  /** Where a picture's copy is, from the document's folder; null keeps only its description. */
  const imageRewriter = (prefix: string) => (src: string): string | null => {
    if (!input.images) return null;
    const saved = input.images.get(src);
    if (saved) return prefix + saved;
    const file = src.match(/\/files\/(\d+)/);
    const path = file ? fileById.get(Number(file[1]))?.path : undefined;
    return path ? prefix + path : null;
  };
  const md = (html: string | null | undefined, prefix: string) => htmlToMarkdown(html, { rewriteHref: rewriter(prefix), rewriteImage: imageRewriter(prefix) });

  const pageSection = (p: Page, level: number, prefix: string) => {
    const body = md(p.body, prefix);
    return [heading(level, p.title ?? p.url ?? 'Untitled page'), '', body || '(This page is empty.)'].join('\n');
  };

  const assignmentSection = (a: Assignment, level: number, prefix: string) => {
    const facts = [
      `- Due: ${a.due_at ?? 'no due date'}`,
      a.points_possible != null ? `- Points: ${a.points_possible}` : '',
      a.submission_types?.length ? `- Submission types: ${a.submission_types.join(', ')}` : '',
      a.allowed_extensions?.length ? `- Allowed file types: ${a.allowed_extensions.join(', ')}` : '',
      a.html_url ? `- In Canvas: ${a.html_url}` : '',
    ].filter(Boolean);
    const desc = md(a.description, prefix);
    return [
      heading(level, a.name),
      '',
      ...facts,
      ...(desc ? ['', heading(level + 1, 'Instructions'), '', desc] : []),
      ...(a.rubric?.length ? ['', rubricMarkdown(a.rubric, level + 1)] : []),
      ...(grades ? ['', resultSection(a, level + 1, prefix)] : []),
    ].join('\n');
  };

  /** The student's own result on an assignment: score, status, class statistics, rubric scores, feedback, quiz questions. */
  const resultSection = (a: Assignment, level: number, prefix: string): string => {
    const s = submissionOf(a);
    const score = scoreText(s?.excused ? null : s?.score, a.points_possible);
    const showGrade = s?.grade && !s.excused && s.grade !== String(s.score) && !(a.grading_type === 'points' || a.grading_type == null);
    const stats = statsById.get(a.id);
    const facts = [
      `- Score: ${score || (s?.excused ? 'excused' : 'not graded yet')}`,
      showGrade ? `- Grade: ${s!.grade}` : '',
      `- Status: ${statusText(a, s, input.generatedAt)}`,
      s?.submitted_at ? `- Submitted: ${s.submitted_at}${s.attempt && s.attempt > 1 ? ` (attempt ${s.attempt})` : ''}` : '',
      s?.graded_at ? `- Graded: ${s.graded_at}` : '',
      stats ? `- Class scores: ${statsText(stats)}` : '',
      a.omit_from_final_grade ? '- Does not count toward the final grade.' : '',
    ].filter(Boolean);
    const lines = [heading(level, 'Your result'), '', ...facts];

    const assessed = s?.rubric_assessment;
    if (a.rubric?.length && assessed && Object.keys(assessed).length) {
      lines.push('', heading(level + 1, 'Your rubric scores'), '');
      for (const c of a.rubric) {
        const r = assessed[c.id];
        if (!r) continue;
        const rating = c.ratings.find((x) => x.id === r.rating_id);
        const got = r.points != null ? `${num(r.points)} / ${num(c.points)} pts` : 'not scored';
        lines.push(`- **${c.description}**: ${got}${rating ? `, ${rating.description}` : ''}${r.comments ? `. Comment: ${oneLine(r.comments)}` : ''}`);
      }
    }

    const comments = (s?.submission_comments ?? []).filter((c) => c.comment?.trim());
    if (comments.length) {
      lines.push('', heading(level + 1, 'Comments'), '');
      for (const c of comments) lines.push(`- **${c.author_name}** (${c.created_at.slice(0, 10)}): ${oneLine(c.comment)}`);
    }

    const body = s?.body ? md(s.body, prefix) : '';
    const attached = (s?.attachments ?? []).map((f) => f.display_name);
    if (body || s?.url || attached.length) {
      lines.push('', heading(level + 1, 'What you handed in'), '');
      if (s?.url) lines.push(`- Link: ${s.url}`);
      if (attached.length) lines.push(`- Files: ${attached.join(', ')} (not included)`);
      if (body) lines.push(...(s?.url || attached.length ? [''] : []), body);
    }

    const quiz = quizByAssignment.get(a.id);
    if (quiz) lines.push('', quizResultMarkdown(quiz, level + 1));
    return lines.join('\n');
  };

  /** A quiz with no assignment of its own (a practice quiz): its title and its question breakdown. */
  const practiceQuizSection = (q: QuizResult, level: number): string =>
    [heading(level, `${q.title} (practice quiz)`), '', ...(q.score != null ? [`- Score: ${scoreText(q.score, q.pointsPossible)}`, ''] : []), quizResultMarkdown(q, level + 1)].join('\n');

  const usedPages = new Set<string>();
  const usedAssignments = new Set<number>();
  const usedFiles = new Set<number>();

  const unitMarkdown = (m: Module, index: number, prefix: string): string => {
    const lines = [heading(1, `Unit ${index + 1}: ${m.name}`), ''];
    for (const item of m.items ?? []) lines.push(unitItem(item, prefix), '');
    return lines.join('\n').trimEnd();
  };

  const unitItem = (item: ModuleItem, prefix: string): string => {
    switch (item.type) {
      case 'SubHeader':
        return heading(2, item.title);
      case 'Page': {
        const page = item.page_url ? pageBySlug.get(item.page_url) : undefined;
        if (page) {
          usedPages.add(page.url ?? String(page.page_id));
          return pageSection({ ...page, title: item.title || page.title }, 2, prefix);
        }
        return `${heading(2, item.title)}\n\n(The page could not be read${item.html_url ? `: ${item.html_url}` : ''}.)`;
      }
      case 'Assignment': {
        const a = item.content_id ? assignmentById.get(item.content_id) : undefined;
        if (a) {
          usedAssignments.add(a.id);
          return assignmentSection({ ...a, name: item.title || a.name }, 2, prefix);
        }
        return `${heading(2, item.title)}\n\n(Assignment not included in this export.)`;
      }
      case 'File': {
        const f = item.content_id ? fileById.get(item.content_id) : undefined;
        if (f) usedFiles.add(f.id);
        const where = [f?.path ? `[original](${prefix}${f.path})` : '', f?.textPath ? `[text](${prefix}${f.textPath})` : ''].filter(Boolean).join(', ');
        return `- File: **${item.title}**${where ? ` (${where})` : f?.note ? ` (${f.note})` : ''}`;
      }
      case 'Quiz': {
        const a = item.content_id ? assignmentByQuiz.get(item.content_id) : undefined;
        if (a) {
          usedAssignments.add(a.id);
          return assignmentSection({ ...a, name: item.title || a.name }, 2, prefix);
        }
        const q = item.content_id ? quizById.get(item.content_id) : undefined;
        if (q) return practiceQuizSection({ ...q, title: item.title || q.title }, 2);
        return `- Quiz: ${item.title} (not included in this export)`;
      }
      case 'ExternalUrl':
        return `- Link: [${item.title}](${item.external_url ?? item.html_url ?? ''})`;
      default:
        return `- ${item.type}: ${item.title} (not included in this export)`;
    }
  };

  /** The whole gradebook in one place: course total, groups, every assignment, quiz tallies. */
  function gradesMarkdown(prefix: string): string {
    const g = grades!;
    const lines = [`# Your grades: ${course.name}`, ''];
    const totals: string[] = [];
    if (g.total?.current != null || g.total?.grade) totals.push(`- Canvas's current total: ${[pct(g.total?.current), g.total?.grade ? `(${g.total.grade})` : ''].filter(Boolean).join(' ')}`);
    if (g.total?.final != null) totals.push(`- Counting work not yet graded as 0: ${pct(g.total.final)}`);

    const model = g.groups.length ? toModel(g.groups.map((grp) => ({ ...grp, assignments: (grp.assignments ?? []).map((a) => ({ ...a, submission: submissionOf(a) })) }))) : null;
    const computed = model ? computeGrade(model.groups, model.items, { weighted: g.weighted }) : null;
    if (!totals.length && computed?.current != null) totals.push(`- Worked out from the scores below (Canvas does not show a total): ${pct(computed.current)}`);
    lines.push(...(totals.length ? totals : ['- Canvas does not show a course total.']), '');

    if (model && computed && model.groups.length) {
      lines.push('## Assignment groups', '', `| Group |${g.weighted ? ' Weight |' : ''} Your score so far | Graded |`, `| --- |${g.weighted ? ' --- |' : ''} --- | --- |`);
      for (const grp of model.groups) {
        const st = computed.groups[grp.id]?.current;
        const total = model.items.filter((i) => i.groupId === grp.id).length;
        const drops = [grp.dropLowest ? `drops lowest ${grp.dropLowest}` : '', grp.dropHighest ? `drops highest ${grp.dropHighest}` : ''].filter(Boolean).join(', ');
        lines.push(`| ${cell(grp.name)}${drops ? ` (${drops})` : ''} |${g.weighted ? ` ${num(grp.weight)}% |` : ''} ${st?.pct != null ? `${pct(st.pct)} (${num(st.earned)} / ${num(st.possible)})` : 'nothing graded'} | ${st?.counted ?? 0} of ${total} |`);
      }
      lines.push('');
    }

    // Every assignment, in gradebook order when the groups are known, else as listed.
    const groupName = new Map<number, string>();
    const order: number[] = [];
    for (const grp of [...g.groups].sort((a, b) => a.position - b.position)) for (const a of grp.assignments ?? []) {
      groupName.set(a.id, grp.name);
      order.push(a.id);
    }
    for (const a of assignments) if (!order.includes(a.id)) order.push(a.id);
    const fromGroups = new Map(g.groups.flatMap((grp) => grp.assignments ?? []).map((a) => [a.id, a]));
    const rows = order.map((id) => assignmentById.get(id) ?? fromGroups.get(id)).filter((a): a is Assignment => !!a);
    if (rows.length) {
      const anyStats = rows.some((a) => statsById.has(a.id));
      lines.push('## Every assignment', '', `| Assignment | Group | Score | Status |${anyStats ? ' Class median |' : ''}`, `| --- | --- | --- | --- |${anyStats ? ' --- |' : ''}`);
      for (const a of rows) {
        const s = submissionOf(a);
        const path = assignmentPath.get(a.id);
        const name = path ? `[${cell(a.name)}](${prefix}${path})` : cell(a.name);
        const score = s?.excused ? 'excused' : scoreText(s?.score, a.points_possible) || (s?.grade ? s.grade : '–');
        const st = statsById.get(a.id);
        lines.push(`| ${name} | ${cell(groupName.get(a.id) ?? '')} | ${score} | ${statusText(a, s, input.generatedAt)} |${anyStats ? ` ${st ? num(st.median) : ''} |` : ''}`);
      }
      lines.push('');
    }

    if (g.quizzes.length) {
      lines.push('## Quizzes, question by question', '');
      for (const q of g.quizzes) {
        const path = q.assignmentId != null ? assignmentPath.get(q.assignmentId) : undefined;
        const summary = tally(q) || q.note || 'no breakdown';
        lines.push(`- ${path ? `[${q.title}](${prefix}${path})` : q.title}: ${summary}`);
      }
      lines.push('');
      const practice = g.quizzes.filter((q) => q.assignmentId == null || !assignmentPath.has(q.assignmentId));
      for (const q of practice) lines.push(practiceQuizSection(q, 2), '');
    }
    return lines.join('\n').trimEnd();
  }

  // ---------- documents ----------

  const syllabus = md(input.syllabusHtml, '');
  if (syllabus) docs.push({ path: 'syllabus.md', title: 'Syllabus', kind: 'syllabus', content: `# Syllabus\n\n${syllabus}\n` });

  const gradesDoc = grades ? gradesMarkdown('') : '';
  if (grades) docs.push({ path: 'grades.md', title: 'Your grades', kind: 'grades', content: `${gradesDoc}\n` });

  const units = modules.filter((m) => (m.items ?? []).length > 0);
  const unitPaths: string[] = [];
  units.forEach((m, i) => {
    const path = uniquePath('units', `${String(i + 1).padStart(2, '0')}-${slugify(m.name, 50)}`, '.md', used);
    unitPaths.push(path);
    docs.push({ path, title: `Unit ${i + 1}: ${m.name}`, kind: 'unit', content: `${unitMarkdown(m, i, '../')}\n` });
  });

  for (const p of pages) {
    const path = pagePath.get(p.url ?? String(p.page_id))!;
    docs.push({ path, title: p.title ?? p.url ?? 'Untitled page', kind: 'page', content: `${pageSection(p, 1, '../')}\n` });
  }
  for (const a of assignments) {
    docs.push({ path: assignmentPath.get(a.id)!, title: a.name, kind: 'assignment', content: `${assignmentSection(a, 1, '../')}\n` });
  }
  for (const f of files) {
    if (!f.text || !f.textPath) continue;
    const from = f.path ? `Text extracted from [${f.name}](../${f.path}).` : `Text extracted from ${f.name}.`;
    docs.push({ path: f.textPath, title: f.name, kind: 'file-text', content: `# ${f.name}\n\n${from}\n\n${f.text}\n` });
  }

  // ---------- one file with all the text ----------

  // Rendered again with no folder to climb out of. Units already contain their pages and assignments,
  // so only the ones outside every unit are added after them.
  const allParts: string[] = [];
  if (syllabus) allParts.push(`# Syllabus\n\n${syllabus}`);
  if (gradesDoc) allParts.push(gradesDoc);
  units.forEach((m, i) => allParts.push(unitMarkdown(m, i, '')));
  for (const p of pages) if (!usedPages.has(p.url ?? String(p.page_id))) allParts.push(pageSection(p, 1, ''));
  for (const a of assignments) if (!usedAssignments.has(a.id)) allParts.push(assignmentSection(a, 1, ''));
  for (const f of files) if (f.text) allParts.push(`# File: ${f.name}\n\n${f.text}`);
  docs.push({
    path: 'ALL_TEXT.md',
    title: 'All course text',
    kind: 'all',
    content: `${[`# ${course.name}: all course text`, ...allParts].join('\n\n---\n\n')}\n`,
  });

  // ---------- README and manifest ----------

  const count = (kind: ExportDoc['kind']) => docs.filter((d) => d.kind === kind).length;
  const originals = files.filter((f) => f.path).length;
  const imageCount = files.filter((f) => f.path && isImageFile(f)).length + new Set(input.images?.values() ?? []).size;
  const notes = files.filter((f) => f.note);
  const readme = [
    `# ${course.name}: course material for an AI tutor`,
    '',
    [course.code, course.term].filter(Boolean).join(' · '),
    `Exported from Canvas with Courseline on ${input.generatedAt.toISOString().slice(0, 10)}.`,
    '',
    '## How to use this folder',
    '',
    '- **Give it to an AI that can read files** (attach the folder or zip), or paste `ALL_TEXT.md` into a chat if it fits.',
    '- Suggested first message:',
    '',
    '  > You are my tutor for this course. Use only the material in these files. When I ask about a concept, find where the course covers it (name the unit, page, assignment or file), explain it step by step, and then ask me a question to check I understood. If the material does not cover something, say so.',
    ...(grades
      ? ['', '- My grades are included (`grades.md`, and a "Your result" part in each assignment). To focus on weak spots:', '', '  > Look at my grades and the questions I got wrong. List the topics I am weakest in, then teach them to me one at a time, starting with the one that costs me the most points.']
      : []),
    '',
    '## What is inside',
    '',
    '| Path | What it is |',
    '| --- | --- |',
    '| `ALL_TEXT.md` | Everything below as text, in one file |',
    syllabus ? '| `syllabus.md` | The course syllabus |' : '',
    grades ? '| `grades.md` | Your scores, the course total, and quiz results question by question |' : '',
    `| \`units/\` | ${count('unit')} unit(s) in the instructor's order, with their pages and assignments inline |`,
    `| \`pages/\` | ${count('page')} page(s) |`,
    `| \`assignments/\` | ${count('assignment')} assignment(s): instructions, due dates, points, rubrics${grades ? ', and your result' : ''} |`,
    `| \`files-text/\` | Text from ${count('file-text')} file(s) (slides, readings, handouts) |`,
    originals ? `| \`files/\` | The ${originals} original file(s)${input.images ? ', images among them' : ''} |` : '',
    input.images?.size ? '| `images/` | Pictures from pages that are not course files (outside links, pasted-in images) |' : '',
    '| `manifest.json` | This list for programs |',
    '',
    '## Units',
    '',
    ...(units.length ? units.map((m, i) => `${i + 1}. ${m.name} (\`${unitPaths[i]}\`)`) : ['This course has no units (modules).']),
    '',
    '## Limits',
    '',
    input.images
      ? `- ${imageCount} image(s) are included and linked where they appear in the text (\`![…](…)\`); give the AI the whole folder so it can look at them. Equations appear as LaTeX. Videos and other embedded content appear as links.`
      : '- Images are not included, only their descriptions. Videos and other embedded content appear as links.',
    grades
      ? '- Quiz questions are included only for classic quizzes, and only as far as Canvas shows them to you. New Quizzes show only the score. Files you handed in are named but not included.'
      : '- Quizzes, discussions and external tools are listed by name but not exported.',
    grades ? '- Discussions and external tools are listed by name but not exported.' : '- Nothing about your own grades or submissions is included.',
    ...(notes.length ? ['', '### Files that are missing or incomplete', '', ...notes.map((f) => `- ${f.name}: ${f.note}`)] : []),
  ]
    .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
    .join('\n');
  docs.unshift({ path: 'README.md', title: 'README', kind: 'readme', content: `${readme}\n` });

  const manifest = {
    course: { id: course.id, name: course.name, code: course.code ?? null, term: course.term ?? null },
    generatedAt: input.generatedAt.toISOString(),
    includesGrades: !!grades,
    includesImages: !!input.images,
    documents: docs.map((d) => ({ path: d.path, title: d.title, kind: d.kind })),
    files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, contentType: f.contentType ?? null, original: f.path ?? null, text: f.textPath ?? null, note: f.note ?? null })),
  };
  docs.push({ path: 'manifest.json', title: 'Manifest', kind: 'manifest', content: `${JSON.stringify(manifest, null, 2)}\n` });
  return docs;
}

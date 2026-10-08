import type { Assignment, Module, ModuleItem, Page, RubricCriterion } from '../api/types';
import { htmlToMarkdown } from './htmlToMarkdown';

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
}

export interface ExportDoc {
  path: string;
  title: string;
  kind: 'readme' | 'all' | 'syllabus' | 'unit' | 'page' | 'assignment' | 'file-text' | 'manifest';
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

  const pageSection = (p: Page, level: number, prefix: string) => {
    const body = htmlToMarkdown(p.body, { rewriteHref: rewriter(prefix) });
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
    const desc = htmlToMarkdown(a.description, { rewriteHref: rewriter(prefix) });
    return [
      heading(level, a.name),
      '',
      ...facts,
      ...(desc ? ['', heading(level + 1, 'Instructions'), '', desc] : []),
      ...(a.rubric?.length ? ['', rubricMarkdown(a.rubric, level + 1)] : []),
    ].join('\n');
  };

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
      case 'ExternalUrl':
        return `- Link: [${item.title}](${item.external_url ?? item.html_url ?? ''})`;
      default:
        return `- ${item.type}: ${item.title} (not included in this export)`;
    }
  };

  // ---------- documents ----------

  const syllabus = htmlToMarkdown(input.syllabusHtml, { rewriteHref: rewriter('../') });
  if (syllabus) docs.push({ path: 'syllabus.md', title: 'Syllabus', kind: 'syllabus', content: `# Syllabus\n\n${syllabus}\n` });

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
  if (syllabus) allParts.push(`# Syllabus\n\n${htmlToMarkdown(input.syllabusHtml, { rewriteHref: rewriter('') })}`);
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
    '',
    '## What is inside',
    '',
    '| Path | What it is |',
    '| --- | --- |',
    '| `ALL_TEXT.md` | Everything below as text, in one file |',
    syllabus ? '| `syllabus.md` | The course syllabus |' : '',
    `| \`units/\` | ${count('unit')} unit(s) in the instructor's order, with their pages and assignments inline |`,
    `| \`pages/\` | ${count('page')} page(s) |`,
    `| \`assignments/\` | ${count('assignment')} assignment(s): instructions, due dates, points, rubrics |`,
    `| \`files-text/\` | Text from ${count('file-text')} file(s) (slides, readings, handouts) |`,
    originals ? `| \`files/\` | The ${originals} original file(s) |` : '',
    '| `manifest.json` | This list for programs |',
    '',
    '## Units',
    '',
    ...(units.length ? units.map((m, i) => `${i + 1}. ${m.name} (\`${unitPaths[i]}\`)`) : ['This course has no units (modules).']),
    '',
    '## Limits',
    '',
    '- Images are not included, only their descriptions. Videos and other embedded content appear as links.',
    '- Quizzes, discussions and external tools are listed by name but not exported.',
    '- Nothing about your own grades or submissions is included.',
    ...(notes.length ? ['', '### Files that are missing or incomplete', '', ...notes.map((f) => `- ${f.name}: ${f.note}`)] : []),
  ]
    .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
    .join('\n');
  docs.unshift({ path: 'README.md', title: 'README', kind: 'readme', content: `${readme}\n` });

  const manifest = {
    course: { id: course.id, name: course.name, code: course.code ?? null, term: course.term ?? null },
    generatedAt: input.generatedAt.toISOString(),
    documents: docs.map((d) => ({ path: d.path, title: d.title, kind: d.kind })),
    files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, contentType: f.contentType ?? null, original: f.path ?? null, text: f.textPath ?? null, note: f.note ?? null })),
  };
  docs.push({ path: 'manifest.json', title: 'Manifest', kind: 'manifest', content: `${JSON.stringify(manifest, null, 2)}\n` });
  return docs;
}

import { describe, expect, it } from 'vitest';
import type { Assignment, Module, Page } from '../api/types';
import { assignFilePaths, buildCourseExport, safeFileName, slugify, uniquePath, type ExportFileInfo } from './courseExport';

const page = (slug: string, title: string, body: string): Page => ({ page_id: slug.length, url: slug, title, body });
const assignment = (id: number, name: string, extra: Partial<Assignment> = {}): Assignment =>
  ({ id, course_id: 1, name, due_at: '2026-10-09T12:00:00Z', points_possible: 10, html_url: `https://c/courses/1/assignments/${id}`, ...extra }) as Assignment;

const modules: Module[] = [
  {
    id: 1,
    name: 'Cells',
    position: 1,
    items: [
      { id: 1, module_id: 1, title: 'Start here', type: 'SubHeader', position: 1 },
      { id: 2, module_id: 1, title: 'Cell basics', type: 'Page', page_url: 'cell-basics', position: 2 },
      { id: 3, module_id: 1, title: 'Lab 1', type: 'Assignment', content_id: 7, position: 3 },
      { id: 4, module_id: 1, title: 'Slides', type: 'File', content_id: 50, position: 4 },
      { id: 5, module_id: 1, title: 'Quiz 1', type: 'Quiz', position: 5 },
    ],
  },
  { id: 2, name: 'Empty unit', position: 2, items: [] },
] as Module[];

const slides: ExportFileInfo = { id: 50, name: 'Slides.pdf', size: 10, path: 'files/slides.pdf', textPath: 'files-text/slides.md', text: '## Page 1\n\nMitochondria' };
const input = () => ({
  course: { id: 1, name: 'Biology 101', code: 'BIO101', term: 'Fall' },
  syllabusHtml: '<p>Grading: <a href="/courses/1/files/50">slides</a></p>',
  modules,
  pages: [page('cell-basics', 'Cell basics', '<p>The cell is the unit of life. See <a href="/courses/1/assignments/7">the lab</a>.</p>'), page('loose', 'A loose page', '<p>Not in a unit</p>')],
  assignments: [
    assignment(7, 'Lab 1', { description: '<p>Draw a cell.</p>', rubric: [{ id: 'c1', description: 'Labels', points: 5, ratings: [{ id: 'r1', description: 'All correct', points: 5 }] }] }),
    assignment(8, 'Extra credit', { description: '<p>Optional.</p>', due_at: null }),
  ],
  files: [slides, { id: 51, name: 'Broken.pdf', size: 99, note: 'could not be downloaded (404)' }],
  generatedAt: new Date('2026-10-08T00:00:00Z'),
});

const byPath = (docs: ReturnType<typeof buildCourseExport>) => Object.fromEntries(docs.map((d) => [d.path, d.content]));

describe('buildCourseExport', () => {
  const docs = byPath(buildCourseExport(input()));

  it('makes the expected set of documents', () => {
    expect(Object.keys(docs).sort()).toEqual([
      'ALL_TEXT.md',
      'README.md',
      'assignments/extra-credit.md',
      'assignments/lab-1.md',
      'files-text/slides.md',
      'manifest.json',
      'pages/a-loose-page.md',
      'pages/cell-basics.md',
      'syllabus.md',
      'units/01-cells.md',
    ]);
  });

  it('puts pages, assignments and file references inline in the unit, in order', () => {
    const unit = docs['units/01-cells.md'];
    expect(unit.indexOf('## Start here')).toBeLessThan(unit.indexOf('## Cell basics'));
    expect(unit).toContain('The cell is the unit of life.');
    expect(unit).toContain('## Lab 1');
    expect(unit).toContain('Draw a cell.');
    expect(unit).toContain('- File: **Slides** ([original](../files/slides.pdf), [text](../files-text/slides.md))');
    expect(unit).toContain('- Quiz: Quiz 1 (not included in this export)');
  });

  it('turns Canvas links into links to the exported copies', () => {
    expect(docs['units/01-cells.md']).toContain('[the lab](../assignments/lab-1.md)');
    expect(docs['syllabus.md']).toContain('[slides](../files/slides.pdf)');
  });

  it('writes the assignment with due date, points and rubric', () => {
    const a = docs['assignments/lab-1.md'];
    expect(a).toContain('- Due: 2026-10-09T12:00:00Z');
    expect(a).toContain('- Points: 10');
    expect(a).toContain('- **Labels** (5 pts)');
    expect(a).toContain('  - 5 pts, All correct');
    expect(docs['assignments/extra-credit.md']).toContain('- Due: no due date');
  });

  it('ALL_TEXT has everything once: unit content, then only what is outside the units, then file text', () => {
    const all = docs['ALL_TEXT.md'];
    expect(all.split('The cell is the unit of life.').length - 1).toBe(1);
    expect(all).toContain('Not in a unit');
    expect(all).toContain('Optional.');
    expect(all).toContain('Mitochondria');
    expect(all).toContain('(files/slides.pdf)'); // links are relative to the root here, not "../"
    expect(all.indexOf('# Unit 1')).toBeLessThan(all.indexOf('# A loose page'));
  });

  it('README explains the folder and lists files that are incomplete', () => {
    const readme = docs['README.md'];
    expect(readme).toContain('Biology 101');
    expect(readme).toContain('BIO101 · Fall');
    expect(readme).toContain('You are my tutor');
    expect(readme).toContain('1. Cells (`units/01-cells.md`)');
    expect(readme).toContain('- Broken.pdf: could not be downloaded (404)');
    expect(readme).toContain('Nothing about your own grades');
  });

  it('manifest is valid JSON that lists the documents and files', () => {
    const manifest = JSON.parse(docs['manifest.json']);
    expect(manifest.course.name).toBe('Biology 101');
    expect(manifest.documents.map((d: { path: string }) => d.path)).toContain('units/01-cells.md');
    expect(manifest.files).toContainEqual(expect.objectContaining({ id: 50, original: 'files/slides.pdf', text: 'files-text/slides.md' }));
  });

  it('copes with an empty course', () => {
    const empty = byPath(buildCourseExport({ ...input(), syllabusHtml: null, modules: [], pages: [], assignments: [], files: [] }));
    expect(Object.keys(empty).sort()).toEqual(['ALL_TEXT.md', 'README.md', 'manifest.json']);
    expect(empty['README.md']).toContain('This course has no units');
  });
});

describe('names', () => {
  it('slugify drops accents and symbols, and is never empty', () => {
    expect(slugify('Introducción: Álgebra & Geometría!')).toBe('introduccion-algebra-geometria');
    expect(slugify('???')).toBe('untitled');
  });

  it('safeFileName removes characters file systems reject', () => {
    expect(safeFileName('a/b:c*.pdf')).toBe('a_b_c_.pdf');
    expect(safeFileName('..hidden')).toBe('hidden');
  });

  it('uniquePath adds a number when a name is taken, ignoring case', () => {
    const used = new Set<string>();
    expect(uniquePath('files', 'notes', '.txt', used)).toBe('files/notes.txt');
    expect(uniquePath('files', 'Notes', '.txt', used)).toBe('files/Notes-2.txt');
  });

  it('assignFilePaths gives originals and text their own folders', () => {
    const f: ExportFileInfo = { id: 1, name: 'My Slides.pptx', size: 1, text: 'x' };
    assignFilePaths(f, new Set(), { original: true });
    expect(f.path).toBe('files/My Slides.pptx');
    expect(f.textPath).toBe('files-text/My Slides.md');
    const g: ExportFileInfo = { id: 2, name: 'a.pdf', size: 1 };
    assignFilePaths(g, new Set(), { original: false });
    expect(g.path).toBeUndefined();
    expect(g.textPath).toBeUndefined();
  });
});

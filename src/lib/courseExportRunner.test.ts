import { describe, expect, it, vi } from 'vitest';
import type { Assignment, Course, CourseFile, Module, Page } from '../api/types';
import { decodeDataImage, ExportCancelled, packExport, scanCourse, type ExportApi, type ExportOptions } from './courseExportRunner';

const file = (id: number, name: string, size = 5, url = `https://files/${id}`): CourseFile => ({ id, display_name: name, filename: name, url, size, 'content-type': name.endsWith('.txt') ? 'text/plain' : 'application/octet-stream' });
const modules: Module[] = [{ id: 1, name: 'Unit', position: 1, items: [{ id: 1, module_id: 1, title: 'Notes', type: 'File', content_id: 2, position: 1 }] }] as Module[];

function fakeApi(over: Partial<ExportApi> = {}): ExportApi {
  return {
    getCourseSyllabus: async () => ({ id: 1, name: 'Biology', course_code: 'BIO', syllabus_body: '<p>See <a href="/courses/1/files/3">outline</a></p>' }) as Course,
    getModules: async () => modules,
    getPages: async () => [{ page_id: 1, url: 'p', title: 'P', body: '<p>Page text</p>' } as Page],
    getAssignments: async () => [{ id: 9, course_id: 1, name: 'HW', due_at: null, points_possible: 1, html_url: '', description: '<p>Do it</p>' } as Assignment],
    getCourseFiles: async () => [file(1, 'notes.txt')],
    getFile: async (id) => file(Number(id), `file-${id}.txt`),
    downloadFile: async (url) => new Blob([`content of ${url}`]),
    ...over,
  };
}

const all: ExportOptions = { includeOriginals: true, extractText: true, maxFileBytes: 1000 };

describe('scanCourse', () => {
  it('collects the course and every file it points at: Files area, unit items and links in the syllabus', async () => {
    const scan = await scanCourse(fakeApi(), 1);
    expect(scan.course.name).toBe('Biology');
    expect(scan.pages).toHaveLength(1);
    expect(scan.assignments).toHaveLength(1);
    expect(scan.files.map((f) => f.id).sort()).toEqual([1, 2, 3]); // 1 from Files, 2 from the unit, 3 from the syllabus link
    expect(scan.warnings).toEqual([]);
  });

  it('turns a failing optional part into a warning and keeps going', async () => {
    const scan = await scanCourse(fakeApi({ getPages: async () => Promise.reject(new Error('Pages tab disabled')), getCourseFiles: async () => null }), 1);
    expect(scan.pages).toEqual([]);
    expect(scan.warnings).toContain('Pages: Pages tab disabled');
  });

  it('notes a file Canvas will not give out, and fails if the course itself cannot be read', async () => {
    const scan = await scanCourse(fakeApi({ getFile: async (id) => (Number(id) === 3 ? Promise.reject(new Error('Forbidden')) : file(Number(id), 'x.txt')) }), 1);
    expect(scan.files.map((f) => f.id).sort()).toEqual([1, 2]);
    expect(scan.warnings).toContain('File 3: Forbidden');
    await expect(scanCourse(fakeApi({ getCourseSyllabus: async () => Promise.reject(new Error('nope')) }), 1)).rejects.toThrow('nope');
  });

  it('stops when cancelled', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(scanCourse(fakeApi(), 1, () => {}, ctl.signal)).rejects.toBeInstanceOf(ExportCancelled);
  });
});

describe('packExport', () => {
  const names = (zip: Awaited<ReturnType<typeof packExport>>['zip']) => Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();

  it('puts documents, original files and extracted text in one root folder', async () => {
    const api = fakeApi();
    const scan = await scanCourse(api, 1);
    const { zip, summary } = await packExport(api, scan, all);
    const root = 'biology-ai-export';
    expect(names(zip)).toEqual(expect.arrayContaining([`${root}/README.md`, `${root}/ALL_TEXT.md`, `${root}/manifest.json`, `${root}/files/notes.txt`, `${root}/files-text/notes.md`, `${root}/units/01-unit.md`]));
    expect(await zip.file(`${root}/files-text/notes.md`)!.async('string')).toContain('content of https://files/1');
    expect(await zip.file(`${root}/files/notes.txt`)!.async('string')).toBe('content of https://files/1');
    expect(summary).toMatchObject({ fileName: `${root}.zip`, originals: 3, textFiles: 3, units: 1, pages: 1, assignments: 1 });
  });

  it('can leave out the original files, or the text', async () => {
    const api = fakeApi();
    const scan = await scanCourse(api, 1);
    const textOnly = await packExport(api, scan, { ...all, includeOriginals: false });
    expect(names(textOnly.zip).some((n) => n.includes('/files/'))).toBe(false);
    expect(names(textOnly.zip).some((n) => n.includes('/files-text/'))).toBe(true);
    const originalsOnly = await packExport(api, scan, { ...all, extractText: false });
    expect(names(originalsOnly.zip).some((n) => n.includes('/files-text/'))).toBe(false);
  });

  it('downloads nothing when neither files nor text are wanted', async () => {
    const downloadFile = vi.fn();
    const api = fakeApi({ downloadFile });
    const scan = await scanCourse(api, 1);
    await packExport(api, scan, { includeOriginals: false, extractText: false, maxFileBytes: 1000 });
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it('skips files over the size limit and files that fail, and says why', async () => {
    const api = fakeApi({
      getCourseFiles: async () => [file(1, 'big.txt', 5_000_000), file(2, 'bad.txt'), file(3, 'ok.txt')],
      downloadFile: async (url) => (url.endsWith('/2') ? Promise.reject(new Error('Could not download the file (500).')) : new Blob(['fine'])),
    });
    const scan = await scanCourse(api, 1);
    const { zip, summary } = await packExport(api, scan, all);
    const root = 'biology-ai-export';
    expect(names(zip).some((n) => n.endsWith('big.txt') || n.endsWith('bad.txt'))).toBe(false);
    expect(zip.file(`${root}/files/ok.txt`)).not.toBeNull();
    expect(summary.notes).toEqual(
      expect.arrayContaining([
        { name: 'big.txt', note: 'too large to include (4.8 MB)' },
        { name: 'bad.txt', note: 'could not be downloaded (Could not download the file (500).)' },
      ]),
    );
    expect(await zip.file(`${root}/README.md`)!.async('string')).toContain('- bad.txt: could not be downloaded');
  });

  it('reports progress and stops when cancelled', async () => {
    const api = fakeApi();
    const scan = await scanCourse(api, 1);
    const seen: string[] = [];
    await packExport(api, scan, all, (p) => seen.push(p.stage));
    expect(seen).toContain('files');
    expect(seen.at(-1)).toBe('packing');
    const ctl = new AbortController();
    ctl.abort();
    await expect(packExport(api, scan, all, () => {}, ctl.signal)).rejects.toBeInstanceOf(ExportCancelled);
  });
});

describe('grades in the export', () => {
  const gradedApi = (over: Partial<ExportApi> = {}) =>
    fakeApi({
      getAssignments: async () => [
        { id: 9, course_id: 1, name: 'HW', due_at: null, points_possible: 10, html_url: '', submission: { workflow_state: 'graded', score: 7 } } as Assignment,
        { id: 10, course_id: 1, name: 'Quiz', due_at: null, points_possible: 2, html_url: '', quiz_id: 5, submission: { workflow_state: 'graded', score: 1 } } as Assignment,
        { id: 11, course_id: 1, name: 'Later', due_at: null, points_possible: 5, html_url: '', submission: { workflow_state: 'unsubmitted' } } as Assignment,
      ],
      getCourse: async () => ({ id: 1, name: 'Biology', enrollments: [{ type: 'student', enrollment_state: 'active', computed_current_score: 80 }] }) as Course,
      getAssignmentGroups: async () => [],
      getMySubmission: async (_c, id, opts) =>
        id === 10 && opts?.history
          ? { workflow_state: 'graded', score: 1, submission_history: [{ attempt: 1, submission_data: [{ question_id: 1, correct: true, answer_id: 1 }, { question_id: 2, correct: false, answer_id: 4 }] }] }
          : { workflow_state: 'graded', score: 7, submission_comments: [{ id: 1, author_name: 'T', comment: 'Nice', created_at: '2026-01-01' }] },
      getQuizzes: async () => [{ id: 5, title: 'Quiz', assignment_id: 10, quiz_type: 'assignment' }],
      getMyQuizSubmissions: async () => [{ id: 77, quiz_id: 5, attempt: 1, score: 1, workflow_state: 'complete' }],
      getQuizQuestionsForAttempt: async () => Promise.reject(new Error('unauthorized')),
      getQuizSubmissionQuestions: async () => [
        { id: 1, position: 1, question_text: '<p>One?</p>', answers: [{ id: 1, text: 'Yes' }] },
        { id: 2, position: 2, question_text: '<p>Two?</p>', answers: [{ id: 4, text: 'No' }] },
      ],
      ...over,
    });

  it('leaves grades out unless asked', async () => {
    const getMySubmission = vi.fn();
    const api = gradedApi({ getMySubmission });
    const { zip, summary } = await packExport(api, await scanCourse(api, 1), all);
    expect(getMySubmission).not.toHaveBeenCalled();
    expect(zip.file('biology-ai-export/grades.md')).toBeNull();
    expect(summary.grades).toBe(false);
  });

  it('reads scores, feedback and quiz questions, skipping work with nothing to show', async () => {
    const api = gradedApi();
    const spy = vi.spyOn(api, 'getMySubmission');
    const { zip, summary } = await packExport(api, await scanCourse(api, 1), { ...all, includeGrades: true, includeQuizResults: true });
    expect(spy.mock.calls.map((c) => c[1]).sort()).toEqual([10, 9]);
    expect(summary).toMatchObject({ grades: true, gradeWarnings: [] });
    const grades = await zip.file('biology-ai-export/grades.md')!.async('string');
    expect(grades).toContain("Canvas's current total: 80%");
    expect(grades).toContain('[Quiz](assignments/quiz.md): 1 of 2 right');
    const quiz = await zip.file('biology-ai-export/assignments/quiz.md')!.async('string');
    expect(quiz).toContain('2. ❌ Wrong');
    expect(quiz).toContain('Two?');
    expect(quiz).toContain('Your answer: No');
  });

  it('turns what Canvas refuses into warnings and keeps the scores', async () => {
    const api = gradedApi({ getQuizzes: async () => Promise.reject(new Error('needs a token')), getMySubmission: async () => Promise.reject(new Error('Forbidden')) });
    const { zip, summary } = await packExport(api, await scanCourse(api, 1), { ...all, includeGrades: true, includeQuizResults: true });
    expect(summary.gradeWarnings).toEqual(['Quizzes: needs a token', 'Feedback for 2 assignment(s) could not be read (Forbidden); their scores are still included.']);
    expect(await zip.file('biology-ai-export/assignments/hw.md')!.async('string')).toContain('- Score: 7 / 10 (70%)');
  });

  it('does not touch quizzes when only grades are wanted', async () => {
    const getQuizzes = vi.fn();
    const api = gradedApi({ getQuizzes });
    await packExport(api, await scanCourse(api, 1), { ...all, includeGrades: true, includeQuizResults: false });
    expect(getQuizzes).not.toHaveBeenCalled();
  });
});

describe('images in the export', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';
  const imageApi = (over: Partial<ExportApi> = {}) =>
    fakeApi({
      getCourseFiles: async () => [file(1, 'notes.txt'), { ...file(4, 'photo.jpg'), 'content-type': 'image/jpeg' }],
      getPages: async () => [
        {
          page_id: 1,
          url: 'p',
          title: 'P',
          body: `<p><img src="/courses/1/files/5/preview" alt="Cell"><img src="${PNG}" alt="Pasted"><img src="https://site.org/a/chart.gif" alt="Chart"><img src="https://bad.org/x.png" alt="Bad"><img src="/equation_images/x" data-equation-content="x^2"></p>`,
        } as Page,
      ],
      getFile: async (id) => ({ ...file(Number(id), Number(id) === 5 ? 'cell.png' : `file-${id}.txt`), 'content-type': Number(id) === 5 ? 'image/png' : 'text/plain' }),
      downloadFile: async (url) => {
        if (url.includes('bad.org')) throw new Error('CORS');
        return new Blob([`content of ${url}`], { type: url.includes('site.org') ? 'image/gif' : '' });
      },
      ...over,
    });

  it('finds pictures in the text: Canvas files, pasted-in and outside ones, but not equations', async () => {
    const scan = await scanCourse(imageApi(), 1);
    expect(scan.imageFileIds).toEqual([5]);
    expect(scan.otherImages).toEqual([PNG, 'https://site.org/a/chart.gif', 'https://bad.org/x.png']);
  });

  it('includes pictures without the other original files, and links them in the text', async () => {
    const api = imageApi();
    const { zip, summary } = await packExport(api, await scanCourse(api, 1), { ...all, includeOriginals: false, includeImages: true });
    const root = 'biology-ai-export';
    const files = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(files).toEqual(expect.arrayContaining([`${root}/files/cell.png`, `${root}/files/photo.jpg`, `${root}/images/image-1.png`, `${root}/images/chart.gif`]));
    expect(files).not.toContain(`${root}/files/notes.txt`);
    const pageMd = await zip.file(`${root}/pages/p.md`)!.async('string');
    expect(pageMd).toContain('![Cell](../files/cell.png)');
    expect(pageMd).toContain('![Pasted](../images/image-1.png)');
    expect(pageMd).toContain('![Chart](../images/chart.gif)');
    expect(pageMd).toContain('[Image: Bad]');
    expect(pageMd).toContain('$x^2$');
    expect(summary.images).toBe(4);
    expect(summary.notes).toContainEqual({ name: '1 image(s) from outside Canvas', note: 'could not be downloaded; only their descriptions are included' });
  });

  it('downloads no pictures when images are off and originals are off', async () => {
    const downloadFile = vi.fn(async (_url: string) => new Blob(['x']));
    const api = imageApi({ downloadFile });
    const { summary } = await packExport(api, await scanCourse(api, 1), { ...all, includeOriginals: false, includeImages: false });
    expect(downloadFile.mock.calls.map((c) => String(c[0])).some((u) => /photo|cell|site\.org|bad\.org/.test(u))).toBe(false);
    expect(summary.images).toBe(0);
  });

  it('decodes data: images', () => {
    expect(decodeDataImage(PNG)).toMatchObject({ type: 'image/png' });
    expect(decodeDataImage(PNG)!.bytes[1]).toBe(0x50); // "P" of the PNG signature
    expect(decodeDataImage('data:text/plain,hi')).toBeNull();
  });
});

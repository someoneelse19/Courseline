import { describe, expect, it, vi } from 'vitest';
import type { Assignment, Course, CourseFile, Module, Page } from '../api/types';
import { ExportCancelled, packExport, scanCourse, type ExportApi, type ExportOptions } from './courseExportRunner';

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

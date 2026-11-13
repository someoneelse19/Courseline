import { describe, expect, it, vi } from 'vitest';
import type { CanvasApi } from '../api/canvas';
import { CanvasApiError } from '../api/client';
import type { Assignment, Course } from '../api/types';
import { createHandler } from './protocol';
import { makeCache, resolveCourse, tools, type ToolContext } from './tools';

const courses: Course[] = [
  { id: 1, name: 'Biología Celular', course_code: 'BIO1', enrollments: [{ type: 'student', enrollment_state: 'active', computed_current_score: 81.25, computed_current_grade: 'B' }] },
  { id: 2, name: 'Cálculo I', course_code: 'MAT1' },
  { id: 3, name: 'Cálculo II', course_code: 'MAT2' },
];
const hw = { id: 9, course_id: 1, name: 'Leaf lab', due_at: '2030-01-01T10:00:00Z', points_possible: 10, html_url: '', description: '<p>Explain photosynthesis in the thylakoid.</p>', submission: { workflow_state: 'graded', score: 8 } } as Assignment;
const old = { id: 10, course_id: 1, name: 'Old essay', due_at: '2020-01-01T10:00:00Z', points_possible: 5, html_url: '', submission: { workflow_state: 'unsubmitted' } } as Assignment;

function ctx(over: Partial<CanvasApi> = {}, readText = vi.fn(async () => 'x'.repeat(70_000))): ToolContext {
  const api = {
    getCourses: vi.fn(async () => courses),
    getCourse: vi.fn(async (id: number) => ({ id, name: `Past course ${id}` })),
    getAssignments: vi.fn(async () => [hw, old]),
    getPages: vi.fn(async () => [{ page_id: 1, url: 'light', title: 'Light reactions', body: '<p>See <a href="/courses/1/files/50/download">notes</a> <img src="/courses/1/files/52/preview" alt="Chloroplast"></p>' }]),
    getCourseSyllabus: vi.fn(async () => ({ id: 1, syllabus_body: '<p>Grading policy</p>' })),
    getModules: vi.fn(async () => []),
    getFile: vi.fn(async (id: number) => ({ id, display_name: 'notes.pdf', filename: 'notes.pdf', size: 10, url: 'https://f/50', 'content-type': 'application/pdf' })),
    downloadFile: vi.fn(async () => new Blob(['%PDF'])),
    ...over,
  } as unknown as CanvasApi;
  return { api, readText, now: () => new Date('2026-11-10T12:00:00Z'), cache: makeCache() };
}
const run = (name: string, args: Record<string, unknown>, c: ToolContext) => tools.find((t) => t.name === name)!.run(args, c);

describe('resolveCourse', () => {
  it('finds a course by id, by name without accents, or by code; asks when it is ambiguous', async () => {
    const c = ctx();
    expect((await resolveCourse(c, 1)).id).toBe(1);
    expect((await resolveCourse(c, 'biologia')).id).toBe(1);
    expect((await resolveCourse(c, 'mat2')).id).toBe(3);
    expect((await resolveCourse(c, '99')).name).toBe('Past course 99'); // not active: asked of Canvas
    await expect(resolveCourse(c, 'calculo')).rejects.toThrow(/more than one course/);
    await expect(resolveCourse(c, 'chemistry')).rejects.toThrow(/No course matches "chemistry"/);
  });
});

describe('tools', () => {
  it('lists courses with their grade', async () => {
    expect((await run('list_courses', {}, ctx())).text).toContain('**Biología Celular** (id 1, BIO1): current grade 81.25% (B)');
  });

  it('filters assignments to upcoming or past', async () => {
    const c = ctx();
    const upcoming = (await run('list_assignments', { course: 1, which: 'upcoming' }, c)).text;
    expect(upcoming).toContain('Leaf lab');
    expect(upcoming).not.toContain('Old essay');
    const past = (await run('list_assignments', { course: 1, which: 'past' }, c)).text;
    expect(past).toContain('| 10 | Old essay |');
    expect(past).toContain('not submitted');
  });

  it('turns Canvas file links and pictures into file ids read_file can open', async () => {
    const text = (await run('read_page', { course: 1, page: 'light reactions' }, ctx())).text;
    expect(text).toContain('[notes](file:50)');
    expect(text).toContain('![Chloroplast](file:52)');
  });

  it('reads a long file in pieces, and extracts it only once', async () => {
    const c = ctx();
    const first = (await run('read_file', { file_id: 50 }, c)).text;
    expect(first).toContain('Call read_file with start=60000');
    const second = (await run('read_file', { file_id: 50, start: 60000 }, c)).text;
    expect(second).not.toContain('start=');
    expect(c.readText).toHaveBeenCalledTimes(1);
  });

  it('returns pictures as images', async () => {
    const c = ctx({ getFile: vi.fn(async () => ({ id: 52, display_name: 'cell.png', filename: 'cell.png', size: 3, url: 'https://f/52', 'content-type': 'image/png' })) as never });
    const out = await run('read_file', { file_id: 52 }, c);
    expect(out.image).toEqual({ data: Buffer.from('%PDF').toString('base64'), mimeType: 'image/png' });
  });

  it('searches the syllabus, pages and assignments, accent- and case-insensitively', async () => {
    const text = (await run('search_course', { course: 1, query: 'THYLAKOID' }, ctx())).text;
    expect(text).toContain('Assignment "Leaf lab" (get_assignment 9)');
    expect((await run('search_course', { course: 1, query: 'mitosis' }, ctx())).text).toMatch(/Nothing in .* mentions "mitosis"/);
  });
});

describe('protocol', () => {
  const handle = createHandler(tools, ctx());

  it('introduces itself, lists the tools as read-only, and ignores notifications', async () => {
    const init = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })) as { result: { protocolVersion: string } };
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const unknownVersion = (await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })) as { result: { protocolVersion: string } };
    expect(unknownVersion.result.protocolVersion).toBe('2025-11-25');
    const list = (await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain('get_grades');
    expect(list.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await handle({ jsonrpc: '2.0', id: 4, method: 'resources/list' })).toMatchObject({ error: { code: -32601 } });
  });

  it('runs a tool, and reports failures as results Claude can read', async () => {
    const res = (await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_courses', arguments: {} } })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(res.result.isError).toBe(false);
    expect(res.result.content[0].text).toContain('Biología');

    const badToken = createHandler(tools, ctx({ getCourses: vi.fn(async () => Promise.reject(new CanvasApiError('Invalid token', 401, 'unauthorized'))) as never }));
    const fail = (await badToken({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_courses', arguments: {} } })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(fail.result.isError).toBe(true);
    expect(fail.result.content[0].text).toMatch(/refused the access token/);
    expect(await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nope' } })).toMatchObject({ error: { code: -32602 } });
  });
});

describe('makeCache', () => {
  it('reuses a result until it expires, and forgets failures', async () => {
    let now = 0;
    const cache = makeCache(1000, () => now);
    const load = vi.fn(async () => 'v');
    await cache.get('k', load);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 2000;
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
    const failing = vi.fn(async () => Promise.reject(new Error('x')));
    await expect(cache.get('f', failing)).rejects.toThrow();
    await expect(cache.get('f', failing)).rejects.toThrow();
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

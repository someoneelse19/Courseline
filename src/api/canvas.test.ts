import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetch, json } from '../test/fakeFetch';
import { createCanvasApi } from './canvas';
import { CanvasApiError } from './client';

afterEach(() => vi.unstubAllGlobals());

const api = () => createCanvasApi({ baseUrl: 'https://school.test', token: 'T' });
const err = (status: number, message: string) => new Response(JSON.stringify({ errors: [{ message }] }), { status });

describe('getCourses', () => {
  it('drops date-restricted stubs that come back without a name', async () => {
    installFetch(({ url }) => (url.pathname === '/api/v1/courses' ? json([{ id: 1, name: 'Bio' }, { id: 3, access_restricted_by_date: true }, { id: 4 }]) : undefined));
    expect((await api().getCourses()).map((c) => c.id)).toEqual([1]);
  });
});

describe('getAssignmentGroups', () => {
  const group = { id: 1, name: 'HW', position: 1, group_weight: 30, assignments: [] };

  it('retries without score_statistics when this Canvas rejects it', async () => {
    const { calls } = installFetch(({ url }) =>
      url.searchParams.getAll('include[]').includes('score_statistics') ? err(400, 'invalid include') : json([group]),
    );
    expect(await api().getAssignmentGroups(7)).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].url.searchParams.getAll('include[]')).toEqual(['assignments', 'submission']);
    expect(calls[0].url.searchParams.get('scope_assignments_to_student')).toBe('true');
  });

  it('does not retry on a real failure like a permission error', async () => {
    const { calls } = installFetch(() => err(403, 'denied'));
    await expect(api().getAssignmentGroups(7)).rejects.toMatchObject({ kind: 'forbidden' });
    expect(calls).toHaveLength(1);
  });
});

describe('getCourseFiles', () => {
  it('returns null (not an error) when the course hides its Files tab', async () => {
    installFetch(() => err(401, 'user not authorized to perform that action'));
    expect(await api().getCourseFiles(1)).toBeNull();
  });
  it('still throws for real failures', async () => {
    installFetch(() => new Response('', { status: 500 }));
    await expect(api().getCourseFiles(1)).rejects.toBeInstanceOf(CanvasApiError);
  });
});

describe('getModules', () => {
  it('refetches the items of modules where Canvas dropped them (more than 50 items)', async () => {
    const { calls } = installFetch(
      ({ url }) =>
        url.pathname === '/api/v1/courses/1/modules'
          ? json([
              { id: 10, name: 'small', position: 1, items_count: 1, items: [{ id: 1, title: 'a' }] },
              { id: 11, name: 'big', position: 2, items_count: 60 },
              { id: 12, name: 'empty', position: 3, items_count: 0 },
            ])
          : undefined,
      ({ url }) => (url.pathname === '/api/v1/courses/1/modules/11/items' ? json([{ id: 99, title: 'late' }]) : undefined),
    );
    const modules = await api().getModules(1);
    expect(modules[1].items).toEqual([{ id: 99, title: 'late' }]);
    expect(modules[0].items).toHaveLength(1);
    expect(modules[2].items).toBeUndefined();
    expect(calls.filter((c) => c.url.pathname.endsWith('/items'))).toHaveLength(1);
  });
});

describe('getPages', () => {
  const page = (slug: string, id: number, body = `<p>${slug}</p>`) => ({ title: slug, url: slug, page_id: id, body });

  it('uses the normal index when it is available', async () => {
    installFetch(
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages' ? json([{ url: 'a' }, { url: 'b' }]) : undefined),
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages/a' ? json(page('a', 1)) : undefined),
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages/b' ? json(page('b', 2)) : undefined),
    );
    expect((await api().getPages(1)).map((p) => p.url)).toEqual(['a', 'b']);
  });

  it('takes bodies from the index (include[]=body) and fetches only the pages that come without one', async () => {
    const { calls } = installFetch(
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages' ? json([page('a', 1), { title: 'b', url: 'b', page_id: 2 }]) : undefined),
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages/b' ? json(page('b', 2)) : undefined),
    );
    const pages = await api().getPages(1);
    expect(pages.map((p) => p.body)).toEqual(['<p>a</p>', '<p>b</p>']);
    expect(calls[0].url.searchParams.getAll('include[]')).toEqual(['body']);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/api/v1/courses/1/pages', '/api/v1/courses/1/pages/b']);
  });

  it('in discovery mode, uses the modules list it is given and does not refetch the front page', async () => {
    const { calls } = installFetch(
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages' ? err(404, 'disabled') : undefined),
      ({ url }) => (url.pathname === '/api/v1/courses/1/front_page' ? json(page('home', 1)) : undefined),
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages/intro' ? json(page('intro', 10)) : undefined),
    );
    const modules = [{ id: 1, name: 'U1', position: 1, items: [{ id: 1, module_id: 1, position: 1, title: 'Intro', type: 'Page', page_url: 'intro' }] }];
    const pages = await api().getPages(1, async () => modules);
    expect(pages.map((p) => p.page_id).sort()).toEqual([1, 10]);
    expect(calls.some((c) => c.url.pathname.endsWith('/modules'))).toBe(false);
    expect(calls.some((c) => c.url.pathname.endsWith('/pages/home'))).toBe(false);
  });

  it('discovers pages itself when the Pages tab is disabled (index 404s), and de-duplicates', async () => {
    const { calls } = installFetch(
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages' ? err(404, 'That page has been disabled for this course') : undefined),
      ({ url }) =>
        url.pathname === '/api/v1/courses/1/modules'
          ? json([{ id: 1, name: 'U1', position: 1, items_count: 2, items: [{ id: 1, type: 'Page', page_url: 'intro' }, { id: 2, type: 'File' }] }])
          : undefined,
      ({ url }) =>
        url.pathname === '/api/v1/courses/1/front_page'
          ? json(page('home', 1, '<a href="/courses/1/pages/second-page">s</a> <a href="/courses/1/pages/old-second">o</a> <a href="/courses/1/pages/gone">g</a>'))
          : undefined,
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages/intro' ? json(page('intro', 10)) : undefined),
      ({ url }) => (url.pathname === '/api/v1/courses/1/pages/home' ? json(page('home', 1)) : undefined),
      // Two different slugs that are really the same page (renamed): must collapse to one.
      ({ url }) => (['second-page', 'old-second'].some((s) => url.pathname.endsWith('/' + s)) ? json(page('second-page', 7)) : undefined),
      // A linked page that no longer exists is skipped, not fatal (the default 404 route handles it).
    );
    const pages = await api().getPages(1);
    expect(pages.map((p) => p.page_id).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 7, 10]);
    expect(calls.some((c) => c.url.pathname.endsWith('/pages/gone'))).toBe(true);
  });

  it('does not swallow unrelated failures', async () => {
    installFetch(() => new Response('', { status: 500 }));
    await expect(api().getPages(1)).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('writes', () => {
  it('marks a module item as read', async () => {
    const { calls } = installFetch(() => json({}));
    await api().markModuleItemRead(1, 2, 3);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/api/v1/courses/1/modules/2/items/3/mark_read');
  });

  it('posts a text submission as nested JSON', async () => {
    const { calls } = installFetch(() => json({ workflow_state: 'submitted' }));
    await api().submitAssignment(1, 2, { submission_type: 'online_text_entry', body: 'my answer' });
    expect(calls[0].url.pathname).toBe('/api/v1/courses/1/assignments/2/submissions');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ submission: { submission_type: 'online_text_entry', body: 'my answer' } });
  });

  it('posts a comment with the real user id', async () => {
    const { calls } = installFetch(() => json({}));
    await api().postSubmissionComment(1, 2, 99, 'hello');
    expect(calls[0].init?.method).toBe('PUT');
    expect(calls[0].url.pathname).toBe('/api/v1/courses/1/assignments/2/submissions/99');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ comment: { text_comment: 'hello' } });
  });

  it('uploads a submission file through the slot endpoint for that assignment', async () => {
    const { calls } = installFetch(
      ({ url }) => (url.pathname.endsWith('/submissions/self/files') ? json({ upload_url: 'https://storage.test/u', upload_params: {} }) : undefined),
      ({ url }) => (url.host === 'storage.test' ? json({ id: 5 }, { status: 201 }) : undefined),
    );
    expect(await api().uploadSubmissionFile(1, 2, new File(['x'], 'a.txt'))).toMatchObject({ id: 5 });
    expect(calls[0].url.pathname).toBe('/api/v1/courses/1/assignments/2/submissions/self/files');
  });
});

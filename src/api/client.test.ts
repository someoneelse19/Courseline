import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetch, json, redirected } from '../test/fakeFetch';
import { CanvasApiError, createClient, downloadTarget, normalizeBaseUrl } from './client';

afterEach(() => vi.unstubAllGlobals());

const BASE = 'https://school.test';
const make = (extra: Partial<Parameters<typeof createClient>[0]> = {}) => createClient({ baseUrl: BASE, token: 'TOKEN', ...extra });

describe('normalizeBaseUrl', () => {
  it.each([
    ['myschool.instructure.com', 'https://myschool.instructure.com'],
    ['https://x.com/', 'https://x.com'],
    ['https://x.com/api/v1', 'https://x.com'],
    ['  http://localhost:3000///  ', 'http://localhost:3000'],
  ])('%s -> %s', (input, expected) => expect(normalizeBaseUrl(input)).toBe(expected));
});

describe('requests', () => {
  it('sends the bearer token and never Canvas cookies', async () => {
    const { calls } = installFetch(() => json({ id: 1 }));
    await make().get('/users/self/profile');
    expect(calls[0].url.href).toBe('https://school.test/api/v1/users/self/profile');
    expect(calls[0].headers.Authorization).toBe('Bearer TOKEN');
    expect(calls[0].init?.credentials).toBe('omit');
  });

  it('writes brackets for array params', async () => {
    const { calls } = installFetch(() => json([]));
    await make().get('/courses', { include: ['total_scores', 'term'], enrollment_state: 'active', skipped: undefined });
    expect(calls[0].url.search).toBe('?include%5B%5D=total_scores&include%5B%5D=term&enrollment_state=active');
  });

  it('sends JSON bodies for writes', async () => {
    const { calls } = installFetch(() => json({ ok: true }));
    await make().send('POST', '/x', { submission: { body: 'hi' } });
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ submission: { body: 'hi' } });
  });

  it('goes through the dev proxy prefix when configured', async () => {
    const { calls } = installFetch(() => json([]));
    await make({ proxyPrefix: '/canvas-proxy' }).get('/courses');
    expect(calls[0].url.pathname).toBe('/canvas-proxy/api/v1/courses');
  });
});

describe('getAll pagination', () => {
  const link = (page: number) => `<https://school.test/api/v1/courses?page=${page}&per_page=100>; rel="next"`;

  it('follows Link rel=next until it runs out and asks for 100 per page', async () => {
    const { calls } = installFetch(({ url }) => {
      const page = Number(url.searchParams.get('page') ?? 1);
      return json([{ id: page }], page < 3 ? { headers: { Link: link(page + 1), 'Content-Type': 'application/json' } } : {});
    });
    const all = await make().getAll<{ id: number }>('/courses');
    expect(all.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(calls[0].url.searchParams.get('per_page')).toBe('100');
  });

  it('re-roots next-page URLs on the proxy', async () => {
    const { calls } = installFetch(({ url }) => (url.searchParams.get('page') ? json([{ id: 2 }]) : json([{ id: 1 }], { headers: { Link: link(2) } })));
    await make({ proxyPrefix: '/canvas-proxy' }).getAll('/courses');
    expect(calls[1].url.pathname).toBe('/canvas-proxy/api/v1/courses');
  });

  it('stops after 50 pages instead of looping forever', async () => {
    const { calls } = installFetch(() => json([{ id: 1 }], { headers: { Link: link(2) } }));
    await make().getAll('/courses');
    expect(calls).toHaveLength(50);
  });
});

describe('error mapping', () => {
  const failing = async (status: number, body: string, onUnauthorized = vi.fn()) => {
    installFetch(() => new Response(body, { status }));
    const err = await make({ onUnauthorized }).get('/x').catch((e: unknown) => e);
    return { err: err as CanvasApiError, onUnauthorized };
  };

  it('a bad token is "unauthorized" and logs you out', async () => {
    const { err, onUnauthorized } = await failing(401, JSON.stringify({ errors: [{ message: 'Invalid access token.' }] }));
    expect(err).toBeInstanceOf(CanvasApiError);
    expect(err.kind).toBe('unauthorized');
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('"not authorized" (e.g. a hidden Files tab) is only "forbidden" and keeps you logged in', async () => {
    const { err, onUnauthorized } = await failing(401, JSON.stringify({ errors: [{ message: 'user not authorized to perform that action' }] }));
    expect(err.kind).toBe('forbidden');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a 403 saying "Rate Limit Exceeded" is a rate limit, a plain 403 is forbidden', async () => {
    expect((await failing(403, '403 Forbidden (Rate Limit Exceeded)')).err.kind).toBe('rate_limit');
    expect((await failing(403, 'nope')).err.kind).toBe('forbidden');
    expect((await failing(429, '')).err.kind).toBe('rate_limit');
  });

  it('maps 404, 5xx and everything else', async () => {
    expect((await failing(404, '')).err.kind).toBe('not_found');
    expect((await failing(503, '')).err.kind).toBe('server');
    expect((await failing(400, JSON.stringify({ errors: [{ message: 'bad include' }] }))).err.message).toBe('bad include');
  });

  it('a failed fetch (offline, DNS, CORS) is a "network" error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = (await make().get('/x').catch((e: unknown) => e)) as CanvasApiError;
    expect(err.kind).toBe('network');
  });
});

describe('downloadTarget', () => {
  const signed = 'https://school.test/files/55/download?download_frd=1&verifier=abc';
  it('re-roots Canvas URLs on the proxy', () => expect(downloadTarget(signed, BASE, '/canvas-proxy')).toBe('/canvas-proxy/files/55/download?download_frd=1&verifier=abc'));
  it('leaves them alone without a proxy', () => expect(downloadTarget(signed, 'school.test', 'https://school.test')).toBe(signed));
  it('resolves relative URLs against Canvas, not the app', () => expect(downloadTarget('/files/55/download?v=1', 'https://school.test/', '/canvas-proxy')).toBe('/canvas-proxy/files/55/download?v=1'));
  it('does not rewrite other hosts', () => expect(downloadTarget('https://storage.test/x.pdf?t=1', BASE, '/canvas-proxy')).toBe('https://storage.test/x.pdf?t=1'));
});

describe('getBlob', () => {
  it('returns the bytes without an Authorization header (signed URLs carry their own)', async () => {
    const { calls } = installFetch(() => new Response('PDFDATA'));
    const blob = await make().getBlob('https://school.test/files/1/download?verifier=v');
    expect(await blob.text()).toBe('PDFDATA');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('throws a CanvasApiError on a failed download', async () => {
    installFetch(() => new Response('', { status: 403 }));
    await expect(make().getBlob('https://school.test/f')).rejects.toMatchObject({ status: 403 });
  });
});

describe('uploadFile (Canvas three-step upload)', () => {
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
  const slot = (extra: object = {}) => ({ upload_url: 'https://storage.test/upload', upload_params: { key: 'k1', policy: 'p' }, ...extra });
  const isSlot = (url: URL) => url.pathname === '/api/v1/courses/1/assignments/2/submissions/self/files';
  const upload = (client = make()) => client.uploadFile('/courses/1/assignments/2/submissions/self/files', file);

  it('asks for a slot with the file details, then posts params first and the file last', async () => {
    const { calls } = installFetch(
      ({ url }) => (isSlot(url) ? json(slot()) : undefined),
      ({ url }) => (url.host === 'storage.test' ? json({ id: 42 }, { status: 201 }) : undefined),
    );
    expect(await upload()).toMatchObject({ id: 42 });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ name: 'notes.txt', size: 5, content_type: 'text/plain' });
    const form = calls[1].init?.body as FormData;
    expect([...form.keys()]).toEqual(['key', 'policy', 'file']);
    expect(calls[1].headers.Authorization).toBeUndefined(); // storage host must not see the token
  });

  it('uses the slot\'s own name for the file field', async () => {
    const { calls } = installFetch(
      ({ url }) => (isSlot(url) ? json(slot({ file_param: 'upload' })) : undefined),
      ({ url }) => (url.host === 'storage.test' ? json({ id: 1 }) : undefined),
    );
    await upload();
    expect([...(calls[1].init?.body as FormData).keys()].pop()).toBe('upload');
  });

  it('accepts a confirmation that arrives after the browser followed the redirect', async () => {
    installFetch(
      ({ url }) => (isSlot(url) ? json(slot()) : undefined),
      ({ url }) => (url.host === 'storage.test' ? redirected(json({ id: 43 }), 'https://school.test/api/v1/files/43/create_success?uuid=u') : undefined),
    );
    expect(await upload()).toMatchObject({ id: 43 });
  });

  it('confirms with the token when the redirect target answers 401', async () => {
    const confirm = 'https://school.test/api/v1/files/44/create_success?uuid=u';
    const { calls } = installFetch(
      ({ url }) => (isSlot(url) ? json(slot()) : undefined),
      ({ url }) => (url.host === 'storage.test' ? redirected(new Response('', { status: 401 }), confirm) : undefined),
      ({ url, headers }) => (url.pathname === '/api/v1/files/44/create_success' && headers.Authorization ? json({ id: 44 }) : undefined),
    );
    expect(await upload()).toMatchObject({ id: 44 });
    expect(calls[2].headers.Authorization).toBe('Bearer TOKEN');
  });

  it('confirms through a Location header when the storage answer carries no file', async () => {
    installFetch(
      ({ url }) => (isSlot(url) ? json(slot()) : undefined),
      ({ url }) => (url.host === 'storage.test' ? new Response('', { status: 201, headers: { Location: 'https://school.test/api/v1/files/45/create_success?uuid=u' } }) : undefined),
      ({ url }) => (url.pathname === '/api/v1/files/45/create_success' ? json({ id: 45 }) : undefined),
    );
    expect(await upload()).toMatchObject({ id: 45 });
  });

  it('routes an upload URL on Canvas itself through the dev proxy', async () => {
    const { calls } = installFetch(
      ({ url }) => (isSlot(url) || url.pathname.endsWith('/submissions/self/files') ? json(slot({ upload_url: 'https://school.test/files/upload' })) : undefined),
      ({ url }) => (url.pathname === '/canvas-proxy/files/upload' ? json({ id: 7 }) : undefined),
    );
    expect(await upload(make({ proxyPrefix: '/canvas-proxy' }))).toMatchObject({ id: 7 });
    expect(calls[1].url.pathname).toBe('/canvas-proxy/files/upload');
  });

  it('explains a browser-blocked upload (CORS on the storage host)', async () => {
    installFetch(({ url }) => (isSlot(url) ? json(slot()) : undefined));
    vi.mocked(fetch).mockImplementationOnce(async () => json(slot())).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const err = (await upload().catch((e: unknown) => e)) as CanvasApiError;
    expect(err.kind).toBe('network');
    expect(err.message).toMatch(/blocked/i);
  });

  it('fails clearly when Canvas never confirms', async () => {
    installFetch(
      ({ url }) => (isSlot(url) ? json(slot()) : undefined),
      ({ url }) => (url.host === 'storage.test' ? json({}) : undefined),
    );
    await expect(upload()).rejects.toThrow(/did not confirm the upload of notes\.txt/);
  });
});

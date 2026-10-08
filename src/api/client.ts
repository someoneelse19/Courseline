// Low-level Canvas HTTP client: auth header, query building, pagination, errors.
// Knows nothing about specific endpoints — see canvas.ts for those.

export type ErrorKind =
  | 'unauthorized' // bad/expired/revoked token
  | 'forbidden' // valid token, not allowed to see this resource
  | 'rate_limit'
  | 'not_found'
  | 'network' // fetch itself failed: offline, DNS, or CORS
  | 'server'
  | 'unknown';

export class CanvasApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: ErrorKind,
  ) {
    super(message);
    this.name = 'CanvasApiError';
  }
}

type ParamValue = string | number | boolean | undefined | string[];
export type Params = Record<string, ParamValue>;

export interface ClientConfig {
  baseUrl: string; // e.g. https://myschool.instructure.com
  token: string;
  /** If set, requests go to this same-origin prefix (Vite dev proxy) instead of baseUrl. */
  proxyPrefix?: string;
  /** Called on any 401 so the app can drop the bad token and show login. */
  onUnauthorized?: () => void;
}

/** Accepts "myschool.instructure.com", "https://x.com/", "https://x.com/api/v1" and returns the origin-ish base. */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function buildQuery(params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      // QUIRK: Canvas array params use PHP/Rails-style brackets: include[]=a&include[]=b.
      // Pass `include: ['a','b']` here and we add the `[]` for you.
      value.forEach((v) => qs.append(`${key}[]`, v));
    } else {
      qs.append(key, String(value));
    }
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// QUIRK: Canvas pagination lives in the `Link` response header, not the body:
//   <https://x.instructure.com/api/v1/courses?page=bookmark:abc&per_page=100>; rel="next", ...
// The page token is opaque ("bookmark:..." or a number) — always follow the
// `next` URL verbatim, never build page=2 yourself. Absence of rel="next" = done.
function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function toApiError(res: Response): Promise<CanvasApiError> {
  // Canvas error bodies look like {"errors":[{"message":"..."}]} but rate-limit
  // responses are plain text, so be defensive.
  let detail = '';
  try {
    const text = await res.text();
    try {
      detail = JSON.parse(text)?.errors?.[0]?.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }

  // QUIRK: rate limiting is signalled with 403 (body "403 Forbidden (Rate Limit
  // Exceeded)"), not 429 — so you must read the body to tell it from a real 403.
  if (res.status === 429 || (res.status === 403 && /rate limit/i.test(detail))) {
    return new CanvasApiError('Canvas rate limit hit. Wait a few seconds and retry.', res.status, 'rate_limit');
  }
  // QUIRK: Canvas uses 401 for BOTH a bad token ("Invalid access token.") and for
  // "you may not access this" ("user not authorized to perform that action", e.g. a
  // course with its Files tab disabled). Only the first means we should log out.
  if (res.status === 401 && /not authorized/i.test(detail)) {
    return new CanvasApiError(detail, 401, 'forbidden');
  }
  if (res.status === 401) {
    return new CanvasApiError('Canvas rejected the token (invalid, expired, or revoked).', 401, 'unauthorized');
  }
  if (res.status === 403) {
    return new CanvasApiError(detail || 'You do not have permission to view this.', 403, 'forbidden');
  }
  if (res.status === 404) {
    return new CanvasApiError(detail || 'Not found.', 404, 'not_found');
  }
  if (res.status >= 500) {
    return new CanvasApiError('Canvas had a server error. Try again shortly.', res.status, 'server');
  }
  return new CanvasApiError(detail || `Request failed (${res.status}).`, res.status, 'unknown');
}

/**
 * Where to fetch a Canvas-hosted URL from: Canvas-origin URLs are re-rooted on `origin` (the real
 * Canvas address, or the dev proxy prefix, which isn't a valid URL base by itself); anything else
 * is fetched as is.
 */
export function downloadTarget(url: string, baseUrl: string, origin: string): string {
  const canvas = new URL(normalizeBaseUrl(baseUrl));
  const u = new URL(url, canvas);
  return u.origin === canvas.origin ? `${origin}${u.pathname}${u.search}` : u.href;
}

/** What Canvas returns once an upload is confirmed (only the field we need). */
export interface UploadedFile {
  id: number;
  display_name?: string;
}

export function createClient({ baseUrl, token, proxyPrefix, onUnauthorized }: ClientConfig) {
  const origin = proxyPrefix ?? normalizeBaseUrl(baseUrl);
  const apiRoot = `${origin}/api/v1`;

  async function fetchUrl(url: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init?.headers },
        // Never send Canvas session cookies; we authenticate with the token only.
        credentials: 'omit',
      });
    } catch {
      // fetch() rejects (with no useful message) on offline, DNS failure AND CORS blocks.
      throw new CanvasApiError(
        'Could not reach Canvas. Check the base URL and your connection. If the console mentions CORS, enable VITE_USE_DEV_PROXY (see README).',
        0,
        'network',
      );
    }

    // Canvas uses a leaky-bucket rate limiter. Remaining quota is reported on every
    // response (starts around 700; each request costs some, and it refills over time).
    const remaining = Number(res.headers.get('X-Rate-Limit-Remaining'));
    if (res.headers.has('X-Rate-Limit-Remaining') && remaining < 100) {
      console.warn(`[canvas] rate-limit bucket low: ${remaining} remaining`);
    }

    if (!res.ok) {
      const err = await toApiError(res);
      if (err.kind === 'unauthorized') onUnauthorized?.();
      throw err;
    }
    return res;
  }

  /** GET a single JSON resource (or a single page of a list). */
  async function get<T>(path: string, params?: Params): Promise<T> {
    const res = await fetchUrl(`${apiRoot}${path}${buildQuery(params)}`);
    return res.json() as Promise<T>;
  }

  /** Write to Canvas (JSON body). Canvas accepts nested JSON like {comment:{text_comment}} for its form-style params. */
  async function send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await fetchUrl(`${apiRoot}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json() as Promise<T>;
  }

  /** GET a list endpoint and follow every `next` page. Use per_page=100 (Canvas's max). */
  async function getAll<T>(path: string, params?: Params): Promise<T[]> {
    const MAX_PAGES = 50; // safety valve against runaway loops
    const items: T[] = [];
    let url: string | null = `${apiRoot}${path}${buildQuery({ per_page: 100, ...params })}`;

    for (let page = 0; url && page < MAX_PAGES; page++) {
      const res: Response = await fetchUrl(url);
      items.push(...((await res.json()) as T[]));

      const next = parseNextLink(res.headers.get('Link'));
      // The `next` URL is absolute and points at the real Canvas host. Re-root it
      // on `origin` so it still goes through the dev proxy when that's enabled.
      url = next ? `${origin}${new URL(next).pathname}${new URL(next).search}` : null;
    }
    return items;
  }

  /**
   * Download a file's bytes. Used with the pre-signed URL from GET /files/:id, which
   * carries its own verifier, so no Authorization header (that would force a CORS
   * preflight and is dropped on Canvas's redirect to file storage anyway).
   */
  async function getBlob(url: string): Promise<Blob> {
    const target = downloadTarget(url, baseUrl, origin);
    let res: Response;
    try {
      res = await fetch(target, { credentials: 'omit' });
    } catch {
      throw new CanvasApiError('Could not download the file.', 0, 'network');
    }
    if (!res.ok) throw new CanvasApiError(`Could not download the file (${res.status}).`, res.status, 'unknown');
    return res.blob();
  }

  /**
   * Upload a file using Canvas's three-step flow (https://canvas.instructure.com/doc/api/file.file_uploads.html):
   *   1. POST `slotPath` with the file's name/size -> Canvas returns where to upload and the form fields to send.
   *   2. POST those fields plus the file (as the LAST field) to that URL, which is often a different host
   *      (file storage), so no Authorization header is sent.
   *   3. Confirm: the storage host answers with a redirect to a Canvas URL, or Canvas's JSON directly. The
   *      browser follows redirects itself; if that final Canvas URL needs the token (401/403), or the answer
   *      only carries a Location header, we GET it with auth. The confirmed file object holds the new file id.
   */
  async function uploadFile(slotPath: string, file: File): Promise<UploadedFile> {
    const slot = await send<{ upload_url: string; upload_params?: Record<string, string>; file_param?: string }>('POST', slotPath, {
      name: file.name,
      size: file.size,
      content_type: file.type || undefined,
      on_duplicate: 'rename',
    });

    const form = new FormData();
    for (const [key, value] of Object.entries(slot.upload_params ?? {})) form.append(key, value);
    form.append(slot.file_param ?? 'file', file); // Canvas requires the file field last

    let res: Response;
    try {
      res = await fetch(downloadTarget(slot.upload_url, baseUrl, origin), { method: 'POST', body: form, credentials: 'omit' });
    } catch {
      throw new CanvasApiError('The browser blocked the upload to Canvas\'s file storage. Submit this file in Canvas instead.', 0, 'network');
    }

    const asFile = async (r: Response): Promise<UploadedFile | null> => {
      const json = await r.json().catch(() => null);
      return json && typeof json.id === 'number' ? (json as UploadedFile) : null;
    };
    if (res.ok) {
      const done = await asFile(res.clone());
      if (done) return done;
    }
    const confirmUrl = res.redirected ? res.url : res.headers.get('Location');
    if (confirmUrl) {
      const confirmed = await asFile(await fetchUrl(downloadTarget(confirmUrl, baseUrl, origin)));
      if (confirmed) return confirmed;
    }
    throw new CanvasApiError(`Canvas did not confirm the upload of ${file.name} (${res.status}).`, res.status, 'unknown');
  }

  return { get, getAll, send, getBlob, uploadFile, origin };
}

export type CanvasClient = ReturnType<typeof createClient>;

import { vi } from 'vitest';

// Replaces the global `fetch` with a router for tests. Each handler looks at the request and returns a
// Response, or undefined to let the next handler try. Unmatched requests get a 404 so a missing route
// is loud. Every request is recorded in `calls`.

export interface Call {
  url: URL;
  init: RequestInit | undefined;
  headers: Record<string, string>;
}

export type Handler = (call: Call) => Response | Promise<Response> | undefined;

/** A JSON Response. */
export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

/** A Response that looks like it arrived after a redirect (the real property is read-only). */
export function redirected(res: Response, finalUrl: string): Response {
  Object.defineProperty(res, 'redirected', { value: true });
  Object.defineProperty(res, 'url', { value: finalUrl });
  return res;
}

export function installFetch(...handlers: Handler[]) {
  const calls: Call[] = [];
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const call: Call = { url, init, headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) } };
    calls.push(call);
    for (const handler of handlers) {
      const res = await handler(call);
      if (res) return res;
    }
    return new Response('no test route for ' + url.pathname, { status: 404 });
  });
  vi.stubGlobal('fetch', fake);
  return { calls, fake };
}

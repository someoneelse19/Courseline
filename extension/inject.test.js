// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync('extension/inject.js', 'utf8');
const realSetTimeout = setTimeout;
const tick = () => new Promise((r) => realSetTimeout(r, 0));

let posted;
const onMessage = (e) => e.data?.source === 'courseline-capture' && posted.push(e.data);

function install(fetchImpl) {
  window.fetch = fetchImpl;
  delete window.__courselineCapture;
  new Function(source)();
}
const apiFetch = () => vi.fn(async () => new Response('while(1);[{"id":1}]', { status: 200, headers: { 'content-type': 'application/json' } }));
const call = async () => {
  await window.fetch('/api/v1/courses');
  await tick();
  await tick();
};

beforeEach(() => {
  posted = [];
  window.addEventListener('message', onMessage);
  document.body.className = '';
  delete window.ENV;
});
afterEach(() => {
  window.removeEventListener('message', onMessage);
  vi.useRealTimers();
});

describe('inject.js', () => {
  it('captures on a Canvas page recognised by its body class, on any domain', async () => {
    document.body.className = 'ic-app';
    install(apiFetch());
    await call();
    await tick();
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toEqual([{ id: 1 }]);
  });

  it('recognises Canvas by its ENV object', async () => {
    window.ENV = { current_user_id: '5' };
    install(apiFetch());
    await call();
    await tick();
    expect(posted).toHaveLength(1);
  });

  it('holds responses until Canvas is recognised, then releases them', async () => {
    install(apiFetch());
    await call();
    await tick();
    expect(posted).toHaveLength(0);
    document.body.className = 'ic-app';
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted).toHaveLength(1);
  });

  it('discards everything on a page that never looks like Canvas', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    install(apiFetch());
    await call();
    vi.advanceTimersByTime(5000);
    document.body.className = 'ic-app'; // too late: the decision was made
    window.dispatchEvent(new Event('load'));
    await tick();
    expect(posted).toHaveLength(0);
  });

  it('ignores non-API requests and failed responses, and returns the real response untouched', async () => {
    document.body.className = 'ic-app';
    install(vi.fn(async (u) => new Response(u === '/nope' ? 'x' : '{}', { status: u === '/api/v1/bad' ? 500 : 200 })));
    const res = await window.fetch('/other');
    await window.fetch('/api/v1/bad');
    await tick();
    await tick();
    await tick();
    expect(posted).toHaveLength(0);
    expect(await res.text()).toBe('{}');
  });

  it('captures any /api/ read, but never a write or a GraphQL mutation', async () => {
    document.body.className = 'ic-app';
    install(vi.fn(async () => new Response('{"ok":1}', { status: 200 })));
    await window.fetch('/api/v1/anything/new');
    await window.fetch('/api/v1/courses/1/submissions', { method: 'POST', body: '{}' });
    await window.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({ operationName: 'ChangeIt', query: 'mutation ChangeIt { go }' }) });
    await window.fetch('/api/graphql', { method: 'POST', body: JSON.stringify({ operationName: 'ReadIt', query: 'query ReadIt { x }' }) });
    await tick();
    await tick();
    await tick();
    const urls = posted.map((p) => new URL(p.url).pathname + (p.operation ? `#${p.operation}` : ''));
    expect(urls.sort()).toEqual(['/api/graphql#ReadIt', '/api/v1/anything/new']);
  });

  it('reports the page has gone quiet once its requests are done, and not while one is still in flight', async () => {
    document.body.className = 'ic-app';
    let release;
    const slow = new Promise((r) => (release = r));
    install(
      vi.fn(async (url) => {
        if (String(url).includes('slow')) await slow;
        return new Response('{"ok":1}', { status: 200 });
      }),
    );
    const idles = () => posted.filter((p) => p.type === 'idle').length;

    // Copies of the script from earlier tests are still attached to this fake window; let their timers run out.
    await new Promise((r) => realSetTimeout(r, 900));
    posted.length = 0;
    const fast = window.fetch('/api/v1/fast');
    const pending = window.fetch('/api/v1/slow');
    await fast;
    await new Promise((r) => realSetTimeout(r, 900));
    expect(idles()).toBe(0); // the slow request is still in flight

    release();
    await pending;
    await new Promise((r) => realSetTimeout(r, 900));
    expect(idles()).toBeGreaterThanOrEqual(1);
  }, 8000);

  it('never reports quiet on a page that is not Canvas', async () => {
    await new Promise((r) => realSetTimeout(r, 900));
    posted.length = 0;
    install(vi.fn(async () => new Response('{}', { status: 200 })));
    await window.fetch('/api/v1/x');
    await new Promise((r) => realSetTimeout(r, 900));
    expect(posted.some((p) => p.type === 'idle')).toBe(false);
  }, 8000);

  it('never clones or reads a response that is not a same-origin /api/ read (video, downloads, other sites)', async () => {
    document.body.className = 'ic-app';
    const clone = vi.fn(() => ({ text: async () => 'x' }));
    install(vi.fn(async () => ({ url: 'https://cdn.example.com/video.mp4', status: 200, clone })));
    await window.fetch('https://cdn.example.com/video.mp4');
    await window.fetch('/files/42/download');
    await tick();
    await tick();
    expect(clone).not.toHaveBeenCalled();
  });

  it('does read a same-origin /api/ response (and only that)', async () => {
    document.body.className = 'ic-app';
    const clone = vi.fn(() => ({ text: async () => '{"ok":1}' }));
    install(vi.fn(async () => ({ url: `${location.origin}/api/v1/courses`, status: 200, clone })));
    await window.fetch('/api/v1/courses');
    await tick();
    await tick();
    expect(clone).toHaveBeenCalledTimes(1);
  });

  describe('the gaps a page could slip through', () => {
    // A stand-in XMLHttpRequest the capture script wraps, answering from `replies` without any network.
    let replies;
    class FakeXHR extends EventTarget {
      constructor() {
        super();
        this.responseType = '';
        this.status = 0;
      }
      open(method, url) {
        this.url = url;
      }
      send() {
        queueMicrotask(() => {
          const r = replies[new URL(this.url, location.href).pathname] ?? { status: 404, text: '' };
          this.status = r.status ?? 200;
          this.responseURL = new URL(this.url, location.href).href;
          this.responseText = this.responseType === '' || this.responseType === 'text' ? r.text : '';
          this.response = this.responseType === 'json' ? r.json : this.responseText;
          this.dispatchEvent(new Event('load'));
          this.dispatchEvent(new Event('loadend'));
        });
      }
    }
    const xhr = (method, url, { type = '', body } = {}) =>
      new Promise((resolve) => {
        const x = new XMLHttpRequest();
        x.responseType = type;
        x.open(method, url);
        x.addEventListener('loadend', () => resolve(x));
        x.send(body);
      });
    const gql = (operationName, query, extra = {}) => JSON.stringify({ operationName, ...(query ? { query } : {}), ...extra });
    const settle = async () => {
      for (let i = 0; i < 5; i++) await tick();
    };

    beforeEach(() => {
      replies = {};
      document.body.className = 'ic-app';
      globalThis.XMLHttpRequest = FakeXHR;
      window.XMLHttpRequest = FakeXHR;
    });

    it('reads an XHR in JSON mode, not only in text mode', async () => {
      install(vi.fn(async () => new Response('{}')));
      replies['/api/v1/courses/1/front_page'] = { json: { url: 'home', title: 'Home' } };
      await xhr('GET', '/api/v1/courses/1/front_page', { type: 'json' });
      await settle();
      expect(posted.find((p) => p.url.endsWith('/front_page'))?.body).toEqual({ url: 'home', title: 'Home' });
    });

    it('names a GraphQL read sent through XHR, and never keeps a mutation sent that way', async () => {
      install(vi.fn(async () => new Response('{}')));
      replies['/api/graphql'] = { text: '{"data":{"x":1}}' };
      await xhr('POST', '/api/graphql', { body: gql('GetThing', 'query GetThing { x }') });
      await xhr('POST', '/api/graphql', { body: gql('ChangeThing', 'mutation ChangeThing { x }') });
      await settle();
      const ops = posted.filter((p) => p.url.endsWith('/api/graphql')).map((p) => p.operation);
      expect(ops).toEqual(['GetThing']);
    });

    it('names a GraphQL read sent as a Request object, and never keeps a mutation sent that way', async () => {
      install(vi.fn(async (input) => new Response('{"data":{"x":1}}', { status: 200, headers: { 'content-type': 'application/json' } })));
      await window.fetch(new Request(`${location.origin}/api/graphql`, { method: 'POST', body: gql('ReadIt', 'query ReadIt { x }') }));
      await window.fetch(new Request(`${location.origin}/api/graphql`, { method: 'POST', body: gql('WriteIt', 'mutation WriteIt { x }') }));
      await settle();
      expect(posted.filter((p) => p.url.endsWith('/api/graphql')).map((p) => p.operation)).toEqual(['ReadIt']);
    });

    it('a persisted query (no query text) that is named like a change is treated as a mutation', async () => {
      install(vi.fn(async () => new Response('{"data":{"x":1}}', { status: 200 })));
      const apq = { extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } } };
      await window.fetch('/api/graphql', { method: 'POST', body: gql('UpdateDashboardPosition', null, apq) });
      await window.fetch('/api/graphql', { method: 'POST', body: gql('GetDashboard', null, apq) });
      await settle();
      expect(posted.filter((p) => p.url.endsWith('/api/graphql')).map((p) => p.operation)).toEqual(['GetDashboard']);
    });
  });
});

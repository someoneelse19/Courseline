import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runs the real background.js against a fake chrome.* so the whole capture pipeline is exercised: what is kept,
// what is dropped, and why.
let store;
let session;
let listener;
let removedListener;

function installChrome() {
  store = {};
  session = {};
  const pick = (keys) => {
    if (keys === null || keys === undefined) return { ...store };
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
    return { ...keys, ...Object.fromEntries(Object.keys(keys).filter((k) => k in store).map((k) => [k, store[k]])) };
  };
  globalThis.chrome = {
    runtime: { onMessage: { addListener: (fn) => (listener = fn) } },
    storage: {
      local: {
        get: async (keys) => pick(keys),
        set: async (obj) => void Object.assign(store, JSON.parse(JSON.stringify(obj))),
        remove: async (keys) => void [].concat(keys).forEach((k) => delete store[k]),
      },
      session: { get: async (k) => (typeof k === 'string' ? (k in session ? { [k]: session[k] } : {}) : { ...session }), set: async (o) => void Object.assign(session, JSON.parse(JSON.stringify(o))) },
    },
    windows: { create: async () => ({ id: 1 }), update: async () => {} },
    tabs: {
      create: vi.fn(async () => ({ id: 7 })),
      get: async () => ({ status: 'complete' }),
      remove: vi.fn(async () => {}),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
      onRemoved: { addListener: (fn) => (removedListener = fn) },
    },
  };
}

const sender = (url = 'https://school.test/courses/1') => ({ tab: { id: 1 }, url });
const app = () => sender('http://localhost:5173/');
// Commands from the Courseline app arrive from its localhost tab (through bridge.js); captures from Canvas pages.
const APP_COMMANDS = ['setCanvasHost', 'openPage', 'cancelPull', 'setPinned'];
const send = async (msg, s = APP_COMMANDS.includes(msg?.type) ? app() : sender()) => {
  let reply;
  const returned = listener(msg, s, (r) => (reply = r));
  await new Promise((r) => setTimeout(r, 25));
  return { reply, keptOpen: returned === true };
};
const capture = (url, body, extra = {}) => ({ type: 'capture', url, body, ...extra });
const keys = () => Object.keys(store).filter((k) => k.startsWith('cap:'));
const saveAddress = () => send({ type: 'setCanvasHost', input: 'school.test' });

beforeEach(async () => {
  vi.resetModules();
  installChrome();
  await import('./background.js');
});

describe('background capture pipeline', () => {
  it('saves the Canvas address the app sends and replies to it', async () => {
    const { reply, keptOpen } = await send({ type: 'setCanvasHost', input: 'https://School.Test/' });
    expect(keptOpen).toBe(true);
    expect(reply).toMatchObject({ ok: true, host: 'school.test' });
    expect(store.canvasHost).toBe('school.test');
    const bad = await send({ type: 'setCanvasHost', input: 'http://x.test' });
    expect(bad.reply).toMatchObject({ ok: false });
    expect(store.canvasHost).toBe('school.test');
  });

  it('ignores app commands that do not come from the local Courseline app', async () => {
    const { reply } = await send({ type: 'setCanvasHost', input: 'evil.test' }, sender('https://evil.test/'));
    expect(reply).toBeUndefined();
    expect(store.canvasHost).toBeUndefined();
    await send({ type: 'setPinned', ids: [9] }, sender('https://school.test/'));
    expect(store.appPinned).toBeUndefined();
  });

  it('keeps nothing until the student has saved a Canvas address, however Canvas-like the page looks', async () => {
    await send(capture('https://evil.test/api/v1/dashboard/dashboard_cards', [{ id: '1', longName: 'Fake' }]), sender('https://evil.test/'));
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }));
    expect(keys()).toHaveLength(0);
    expect(store.canvasHost).toBeUndefined(); // a page never gets to choose the host
  });

  it('saves a valid Canvas response from the saved address, and strips personal fields', async () => {
    await saveAddress();
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio', email: 'me@school.test' }));
    expect(keys()).toHaveLength(1);
    expect(store[keys()[0]].body).toEqual({ id: 1, name: 'Bio' });
    expect(store.health.course.ok).toBe(1);
  });

  it('drops a response whose URL is not on the page that sent it', async () => {
    await send(capture('https://evil.test/api/v1/courses/1', { id: 1, name: 'Fake' }), sender('https://school.test/courses/1'));
    expect(keys()).toHaveLength(0);
    expect(store.canvasHost).toBeUndefined();
  });

  it('ignores any other host once an address is saved', async () => {
    await saveAddress();
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }));
    await send(capture('https://other.test/api/v1/courses/2', { id: 2, name: 'Other' }), sender('https://other.test/'));
    expect(keys()).toHaveLength(1);
    expect(store.canvasHost).toBe('school.test');
  });

  it('keeps nothing about a course that is not pinned, once the pinned set is known', async () => {
    await saveAddress();
    await send(capture('https://school.test/api/v1/dashboard/dashboard_cards', [{ id: '1', longName: 'Bio' }]));
    await send(capture('https://school.test/api/v1/courses/9', { id: 9, name: 'Not pinned' }));
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }));
    expect(store.pinned).toEqual([1]);
    expect(keys().some((k) => k.includes('/courses/9'))).toBe(false);
    expect(keys().some((k) => k.includes('/courses/1'))).toBe(true);
  });

  it('prefers the courses chosen in the app over the dashboard', async () => {
    await saveAddress();
    await send({ type: 'setPinned', ids: [9] });
    expect(store.appPinned).toEqual([9]);
    await send(capture('https://school.test/api/v1/dashboard/dashboard_cards', [{ id: '1', longName: 'Bio' }]));
    await send(capture('https://school.test/api/v1/courses/9', { id: 9, name: 'Chosen' }));
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }));
    expect(keys().some((k) => k.includes('/courses/9'))).toBe(true);
    expect(keys().some((k) => k.includes('/courses/1'))).toBe(false);
  });

  it('clears the app choice when it sends none, and ignores an invalid list', async () => {
    await send({ type: 'setPinned', ids: [1, 2] });
    await send({ type: 'setPinned', ids: ['x'] });
    expect(store.appPinned).toEqual([1, 2]);
    await send({ type: 'setPinned', ids: null });
    expect(store.appPinned).toBeUndefined();
  });

  it('saves a response with no reader in full, as "other", and counts it', async () => {
    await saveAddress();
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }));
    await send(capture('https://school.test/api/v1/courses/1/discussion_topics/5/view', { view: [{ id: 1, message: 'hi', token: 'secret' }] }));
    const rec = Object.values(store).find((r) => r?.kind === 'other');
    expect(rec.route).toBe('GET /courses/:id/discussion_topics/:id/view');
    expect(rec.courseId).toBe(1);
    expect(rec.body).toEqual({ view: [{ id: 1, message: 'hi' }] });
    expect(store.unmapped['GET /courses/:id/discussion_topics/:id/view'].count).toBe(1);
  });

  it('never saves credential endpoints, and keeps nothing about an unpinned course even with no reader', async () => {
    await saveAddress();
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }));
    await send(capture('https://school.test/api/v1/jwts', { token: 'live-token' }));
    expect(JSON.stringify(store)).not.toContain('live-token');
    await send({ type: 'setPinned', ids: [1] });
    await send(capture('https://school.test/api/v1/courses/9/some_new_thing', { a: 1 }));
    expect(Object.values(store).some((r) => r?.route?.includes('some_new_thing'))).toBe(false);
  });

  it('ignores messages that did not come from a tab, and unread addresses before a host is pinned', async () => {
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }), { url: 'https://school.test/' });
    expect(keys()).toHaveLength(0);
    await send(capture('https://school.test/api/v1/some/new/thing', { a: 1 }));
    expect(store.unmapped).toBeUndefined();
    expect(keys()).toHaveLength(0);
  });

  it('opens a page in a background tab on the pinned address only, closes it, and reports what came in', async () => {
    await send({ type: 'setCanvasHost', input: 'school.test' });
    await send(capture('https://school.test/api/v1/courses/1', { id: 1, name: 'Bio' }));

    let reply;
    listener({ type: 'openPage', url: 'https://school.test/courses/1/announcements' }, app(), (r) => (reply = r));
    await new Promise((r) => setTimeout(r, 60));
    // While the page loads, Canvas's own page makes a request that the capture script forwards.
    await send(capture('https://school.test/api/v1/courses/1/announcements', [{ id: 1, title: 'Welcome', message: 'hi' }, { id: 2, title: 'Week 2' }]));
    // Canvas's page finishes its requests and reports it has gone quiet: the pull moves on right then.
    const quietAt = Date.now();
    listener({ type: 'pageIdle' }, { tab: { id: 7 }, url: 'https://school.test/courses/1/announcements' });
    await new Promise((r) => setTimeout(r, 500));
    expect(reply).toBeDefined();
    expect(Date.now() - quietAt).toBeLessThan(1500); // not a fixed multi-second wait

    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://school.test/courses/1/announcements', active: false }));
    expect(chrome.tabs.remove).toHaveBeenCalledWith(7);
    expect(reply).toMatchObject({ ok: true, loaded: true, captured: 1 });
    expect(reply.items[0]).toMatchObject({ label: 'GET /courses/:id/announcements', sample: ['Welcome', 'Week 2'] });
    // It is remembered as opened, so the next batch of linked pages skips it.
    expect(store.visited['https://school.test/courses/1/announcements']).toBeGreaterThan(0);
    // The hourly page count survives the worker being shut down: it is kept in session storage, not in memory.
    expect(session.opened).toHaveLength(1);
    expect(session.pullTabs).toEqual([]); // the tab was closed again
  }, 10000);

  it('refuses a page that is not on the pinned Canvas address, or not https', async () => {
    await send({ type: 'setCanvasHost', input: 'school.test' });
    const ask = async (url) => (await send({ type: 'openPage', url })).reply;
    expect(await ask('https://evil.test/courses/1')).toMatchObject({ ok: false });
    expect(await ask('http://school.test/courses/1')).toMatchObject({ ok: false });
    expect(await ask('not a url')).toMatchObject({ ok: false });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('Stop closing the tab ends the wait at once, and the page is not marked as opened', async () => {
    await saveAddress();
    let reply;
    const started = Date.now();
    listener({ type: 'openPage', url: 'https://school.test/courses/1/files' }, app(), (r) => (reply = r));
    await new Promise((r) => setTimeout(r, 80));
    removedListener(7); // Stop closed it (or the student did)
    await new Promise((r) => setTimeout(r, 300));
    expect(reply).toMatchObject({ ok: true, stopped: true });
    expect(Date.now() - started).toBeLessThan(2000); // not the 12-32 s of timeouts
    expect(store.visited?.['https://school.test/courses/1/files']).toBeUndefined();
  });

  it('does not mark a page as opened when it never finished loading', async () => {
    await saveAddress();
    chrome.tabs.get = async () => ({ status: 'loading' });
    let reply;
    listener({ type: 'openPage', url: 'https://school.test/courses/1/quizzes' }, app(), (r) => (reply = r));
    await new Promise((r) => setTimeout(r, 80));
    removedListener(7); // ends the test quickly: the page never loaded
    await new Promise((r) => setTimeout(r, 300));
    expect(reply?.loaded).toBe(false);
    expect(store.visited?.['https://school.test/courses/1/quizzes']).toBeUndefined();
  });

  it('a known route in an unexpected format is kept raw under its own key, and never replaces the good copy', async () => {
    await saveAddress();
    await send(capture('https://school.test/api/v1/courses/1/assignments/5', { id: 5, name: 'Essay', description: 'good' }));
    await send(capture('https://school.test/api/v1/courses/1/assignments/5', { id: 5 })); // no name: not the usual shape
    const good = store['cap:school.test/courses/1/assignments/5?'];
    const raw = store['cap:rejected:school.test/courses/1/assignments/5?'];
    expect(good).toMatchObject({ kind: 'assignment', body: { name: 'Essay', description: 'good' } });
    expect(raw).toMatchObject({ kind: 'other', rejectedAs: 'assignment', route: 'GET /courses/:id/assignments/:id', body: { id: 5 } });
    expect(store.health.assignment).toMatchObject({ ok: 1, badShape: 1 });
  });
});

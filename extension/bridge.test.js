// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://localhost:5173/"}
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

// Runs the real bridge.js against a fake chrome, as the Courseline app's page would see it.
const runnerPath = resolve('extension/lib/pullRunner.js');
let sent; // messages the bridge sent to the background
let replies; // what the app page received from it
let active;
let fromExtension; // the bridge's listener for messages from the popup or background
let pageDelay = 0;

// jsdom leaves a posted message's source and origin empty; a real browser sets both, and bridge.js checks them.
const realPostMessage = window.postMessage.bind(window);
window.postMessage = (data) => {
  void realPostMessage;
  window.dispatchEvent(new MessageEvent('message', { data, source: window, origin: window.location.origin }));
};

function setup() {
  sent = [];
  replies = [];
  document.head.innerHTML = '<meta name="courseline-app" content="1">';
  delete document.documentElement.dataset.courselineExtension;
  Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: active }) });
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      getURL: () => runnerPath,
      onMessage: { addListener: (fn) => (fromExtension = fn) },
      sendMessage: vi.fn(async (msg) => {
        sent.push(msg);
        if (msg.type === 'openPage') {
          await new Promise((r) => setTimeout(r, pageDelay));
          return { ok: true, loaded: true, captured: 1, items: [] };
        }
        return { ok: true };
      }),
    },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
  };
}

const ask = async (msg) => {
  window.postMessage({ source: 'courseline-app', ...msg }, window.location.origin);
  await new Promise((r) => setTimeout(r, 30));
};

const listener = (e) => e.data?.source === 'courseline-extension' && replies.push(e.data);
beforeEach(async () => {
  vi.resetModules();
  active = true;
  pageDelay = 0;
  setup();
  window.removeEventListener('message', listener);
  window.addEventListener('message', listener);
  await import('./bridge.js');
});

describe('bridge.js pull', () => {
  const steps = [{ url: 'https://school.test/courses/1/grades', label: 'Grades' }];

  it('marks the page as Courseline and starts a run that came from a click', async () => {
    expect(document.documentElement.dataset.courselineExtension).toBe('9.9.9');
    await ask({ id: 'a', type: 'pull', steps });
    await new Promise((r) => setTimeout(r, 4000));
    expect(replies.find((r) => r.id === 'a')).toMatchObject({ ok: true, total: 1 });
    expect(sent.some((m) => m.type === 'openPage' && m.url === steps[0].url)).toBe(true);
    expect(replies.some((r) => r.type === 'pullDone' && r.runId === 'a' && r.cancelled === false)).toBe(true);
  }, 12000);

  it('refuses to start a run when there was no click, so a script on the page cannot', async () => {
    active = false;
    await ask({ id: 'b', type: 'pull', steps });
    expect(replies.some((r) => r.id === 'b' && r.ok)).toBe(false);
    expect(replies.some((r) => r.id === 'b')).toBe(true);
    expect(sent.some((m) => m.type === 'openPage')).toBe(false);
  });

  it('lets a confirmed run continue without a second click, but only from the run that just finished', async () => {
    await ask({ id: 'first', type: 'pull', steps });
    await new Promise((r) => setTimeout(r, 4000));
    active = false;
    await ask({ id: 'second', type: 'pull', steps, continueFrom: 'first' });
    expect(replies.some((r) => r.id === 'second' && r.ok)).toBe(true);
    await new Promise((r) => setTimeout(r, 4000));
    await ask({ id: 'third', type: 'pull', steps, continueFrom: 'not-a-run' });
    expect(replies.some((r) => r.id === 'third' && r.ok)).toBe(false);
    expect(replies.some((r) => r.id === 'third')).toBe(true);
  }, 20000);
});

describe('bridge.js pull safety', () => {
  const steps = [{ url: 'https://school.test/courses/1/grades', label: 'Grades' }];

  it('a continuation is single-use and cannot be chained: more runs need a click', async () => {
    await ask({ id: 'one', type: 'pull', steps });
    await new Promise((r) => setTimeout(r, 1500));
    active = false;
    await ask({ id: 'two', type: 'pull', steps, continueFrom: 'one' });
    expect(replies.some((r) => r.id === 'two' && r.ok)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    await ask({ id: 'three', type: 'pull', steps, continueFrom: 'two' }); // a continuation cannot be continued
    expect(replies.some((r) => r.id === 'three' && r.ok)).toBe(false);
    await ask({ id: 'four', type: 'pull', steps, continueFrom: 'one' }); // and the first was already used up
    expect(replies.some((r) => r.id === 'four' && r.ok)).toBe(false);
  }, 15000);

  it('turns away a second start that arrives while the first is still starting (a double click)', async () => {
    pageDelay = 800;
    window.postMessage({ source: 'courseline-app', id: 'first', type: 'pull', steps }, window.location.origin);
    window.postMessage({ source: 'courseline-app', id: 'second', type: 'pull', steps }, window.location.origin);
    await new Promise((r) => setTimeout(r, 300));
    expect(replies.some((r) => r.id === 'first' && r.ok)).toBe(true);
    expect(replies.find((r) => r.id === 'second')).toMatchObject({ ok: false, busy: true });
    await new Promise((r) => setTimeout(r, 2500)); // let it finish so it does not leak into the next test
  }, 10000);
});

describe('bridge.js and the popup button', () => {
  it('passes "show the plan" from the popup to the app page, without any navigation', async () => {
    fromExtension({ type: 'openPlan' });
    await new Promise((r) => setTimeout(r, 30));
    expect(replies.some((r) => r.type === 'openPlan')).toBe(true);
  });

  it('ignores other messages from the extension', async () => {
    fromExtension({ type: 'something-else' });
    await new Promise((r) => setTimeout(r, 30));
    expect(replies.some((r) => r.type === 'something-else')).toBe(false);
  });
});

describe('bridge.js on another localhost page', () => {
  it('answers nothing when the page is not Courseline', async () => {
    document.head.innerHTML = '';
    await ask({ id: 'c', type: 'hello' });
    expect(replies.find((r) => r.id === 'c')).toBeUndefined();
  });
});

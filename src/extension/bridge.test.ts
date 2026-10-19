import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelPull, extensionInstalled, loadSnapshot, onExtensionChange, onPullEvent, startPull } from './bridge';

const snapshot = { records: [{ kind: 'course', courseId: 1, host: 'h', url: 'u', capturedAt: 1, body: {} }], health: {}, takenAt: 5 };

// Plays the part of the extension's bridge.js: answers messages the app posts.
function fakeBridge() {
  const handler = (event: MessageEvent) => {
    const m = event.data as { source?: string; id?: string; type?: string };
    if (m?.source !== 'courseline-app') return;
    const reply =
      m.type === 'snapshot' ? snapshot : m.type === 'pull' ? { ok: true, runId: m.id, total: (m as { steps?: unknown[] }).steps?.length ?? 0 } : m.type === 'cancelPull' ? { ok: true } : { version: '1' };
    window.postMessage({ source: 'courseline-extension', id: m.id, ...reply }, window.location.origin);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

beforeEach(() => {
  delete document.documentElement.dataset.courselineExtension;
});
afterEach(() => {
  delete document.documentElement.dataset.courselineExtension;
});

describe('extension bridge client', () => {
  it('knows the extension is absent without waiting', async () => {
    expect(extensionInstalled()).toBe(false);
    const started = Date.now();
    expect(await loadSnapshot()).toBeNull();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('loads a snapshot when the extension is installed', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const stop = fakeBridge();
    const got = await loadSnapshot();
    stop();
    expect(got?.records).toHaveLength(1);
    expect(got?.takenAt).toBe(5);
  });

  it('starts a pull and gets a run id back, and can cancel it', async () => {
    const stop = fakeBridge();
    const out = await startPull([{ url: 'https://h/courses/1', label: 'Course' }]);
    expect(out).toMatchObject({ ok: true, total: 1 });
    await expect(cancelPull()).resolves.toBeUndefined();
    stop();
  });

  it('reports a clear error when the extension does not answer a pull', async () => {
    const out = await startPull([{ url: 'https://h/x', label: 'x' }]);
    expect(out).toMatchObject({ ok: false });
  }, 10000);

  it('delivers pull progress events to a listener', async () => {
    const seen: string[] = [];
    const off = onPullEvent((e) => seen.push(`${e.type}:${e.runId}`));
    window.postMessage({ source: 'courseline-extension', type: 'pullProgress', runId: 'r1', index: 0, total: 1, state: 'visiting', step: { url: 'u', label: 'l' } }, window.location.origin);
    window.postMessage({ source: 'courseline-extension', type: 'pullDone', runId: 'r1', cancelled: false, results: [] }, window.location.origin);
    window.postMessage({ source: 'courseline-extension', type: 'changed' }, window.location.origin);
    await new Promise((r) => setTimeout(r, 10));
    off();
    expect(seen).toEqual(['pullProgress:r1', 'pullDone:r1']);
  });

  it('reports change notifications, and stops after unsubscribe', async () => {
    let n = 0;
    const off = onExtensionChange(() => n++);
    window.postMessage({ source: 'courseline-extension', type: 'changed' }, window.location.origin);
    await new Promise((r) => setTimeout(r, 10));
    off();
    window.postMessage({ source: 'courseline-extension', type: 'changed' }, window.location.origin);
    await new Promise((r) => setTimeout(r, 10));
    expect(n).toBe(1);
  });

  it('ignores messages that are not from the extension', async () => {
    let n = 0;
    const off = onExtensionChange(() => n++);
    window.postMessage({ source: 'someone-else', type: 'changed' }, window.location.origin);
    await new Promise((r) => setTimeout(r, 10));
    off();
    expect(n).toBe(0);
  });
});

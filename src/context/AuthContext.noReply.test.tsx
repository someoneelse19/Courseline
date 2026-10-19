import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../extension/bridge';
import { AuthProvider, useAuth } from './AuthContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The extension is installed, but sometimes it does not answer in time (busy, or just reloaded). That must not be
// mistaken for "nothing has been captured".
let answers: Array<Snapshot | null>;
let changed: () => void;
const record = (kind: string, courseId: number | null, body: unknown) => ({ kind, courseId, host: 'school.test', url: 'u', capturedAt: 1, body });
const snapshot: Snapshot = {
  records: [record('dashboardCards', null, [{ id: '1', longName: 'Biology' }]), record('course', 1, { id: 1, name: 'Biology', enrollments: [{ type: 'student', user_id: 42 }] })],
  health: {},
  appPinned: null,
  canvasHost: 'school.test',
  takenAt: 1,
};

vi.mock('../extension/bridge', () => ({
  extensionInstalled: () => true,
  loadSnapshot: async () => (answers.length > 1 ? answers.shift()! : answers[0]),
  onExtensionChange: (cb: () => void) => {
    changed = cb;
    return () => {};
  },
}));

function Probe() {
  const a = useAuth();
  return <p>{`${a.status}|${a.source}`}</p>;
}

let root: ReturnType<typeof createRoot>;
let el: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

describe('a missing answer from the extension', () => {
  it('does not sign a signed-in student out', async () => {
    answers = [snapshot, null];
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
    await wait(50);
    expect(el.textContent).toBe('authenticated|extension');

    await act(async () => changed()); // something was captured; the reload that follows gets no answer
    await wait(1800);
    expect(el.textContent).toBe('authenticated|extension');
  });

  it('but a real "nothing captured" answer (the data was cleared) does show the login page again', async () => {
    answers = [snapshot, { ...snapshot, records: [] }];
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
    await wait(50);
    expect(el.textContent).toBe('authenticated|extension');
    await act(async () => changed());
    await wait(1800);
    expect(el.textContent).toBe('unauthenticated|token');
  });

  it('with no answer at all on the first load, shows the login page rather than waiting forever', async () => {
    answers = [null];
    await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
    await wait(50);
    expect(el.textContent).toBe('unauthenticated|token');
  });
});

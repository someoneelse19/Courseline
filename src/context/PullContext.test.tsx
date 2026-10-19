import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullEvent, PullStep, Snapshot } from '../extension/bridge';
import { PullProvider, usePull, type PullValueForTest } from './PullContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A fake extension: remembers what it was asked to open, and lets the test play out the events.
let listeners: Array<(e: PullEvent) => void>;
let started: PullStep[][];
let snapshot: Snapshot | null;
let startReply: { ok: true; runId: string; total: number } | { ok: false; error: string };
let planListeners: Array<() => void>;
let snapshotLoads: number;
const cancelPull = vi.fn(async () => {});

vi.mock('../extension/bridge', () => ({
  loadSnapshot: async () => {
    snapshotLoads += 1;
    return snapshot;
  },
  onOpenPlanRequest: (cb: () => void) => {
    planListeners.push(cb);
    return () => (planListeners = planListeners.filter((l) => l !== cb));
  },
  startPull: async (steps: PullStep[]) => {
    started.push(steps);
    return startReply;
  },
  cancelPull: () => cancelPull(),
  onPullEvent: (cb: (e: PullEvent) => void) => {
    listeners.push(cb);
    return () => (listeners = listeners.filter((l) => l !== cb));
  },
}));

const emit = (e: PullEvent) => act(async () => void listeners.forEach((l) => l(e)));
const rec = (kind: string, courseId: number | null, body: unknown) => ({ kind, courseId, host: 'school.test', url: 'u', capturedAt: 1, body });
const snap = (records: Snapshot['records'], canvasHost: string | null = 'school.test'): Snapshot => ({ records, health: {}, appPinned: null, canvasHost, takenAt: 1 });
const withCourses = snap([rec('dashboardCards', null, [{ id: '1', longName: 'Biology' }]), rec('course', 1, { id: 1, name: 'Biology' })]);

let api: PullValueForTest;
function Grab() {
  api = usePull();
  return null;
}

let root: ReturnType<typeof createRoot>;
async function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root.render(<PullProvider><Grab /></PullProvider>));
}
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

beforeEach(() => {
  listeners = [];
  planListeners = [];
  snapshotLoads = 0;
  started = [];
  snapshot = withCourses;
  startReply = { ok: true, runId: 'r1', total: 0 };
  cancelPull.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

describe('PullProvider', () => {
  it('shows the plan and waits for Start; Cancel closes it without opening anything', async () => {
    await mount();
    await act(async () => api.requestSync());
    await tick();
    expect(api.state?.phase).toBe('confirm');
    expect(api.state?.planCount).toBe(4 + 10); // account pages + ten pages for one course
    // The confirmation is in the page itself.
    expect(document.body.textContent).toContain('This will open 14 Canvas pages');
    expect(document.body.textContent).toContain('background tabs');
    expect(document.body.textContent).toContain('Start');
    expect(started).toEqual([]);
    await act(async () => api.close());
    expect(api.state).toBeNull();
    expect(started).toEqual([]);
  });

  it('essentials only changes the plan before anything starts', async () => {
    await mount();
    await act(async () => api.requestSync());
    await tick();
    await act(async () => api.setDepth('essential'));
    await tick();
    expect(api.state?.planCount).toBe(4);
  });

  it('runs on Start, updates each page as events arrive, and finishes with a summary', async () => {
    await mount();
    await act(async () => api.requestSync({ depth: 'essential' }));
    await tick();
    await act(async () => api.start());
    await tick();
    expect(started[0].map((s) => s.url)).toEqual([
      'https://school.test/courses/1/assignments',
      'https://school.test/courses/1/grades',
      'https://school.test/courses/1/modules',
      'https://school.test/courses/1/pages',
    ]);
    expect(api.state?.phase).toBe('running');
    await emit({ type: 'pullProgress', runId: 'r1', index: 0, total: 4, step: started[0][0], state: 'visiting' });
    expect(api.state?.rows[0].state).toBe('visiting');
    await emit({ type: 'pullProgress', runId: 'r1', index: 0, total: 4, step: started[0][0], state: 'done', outcome: { captured: 3, items: [{ label: 'GET /x', count: 3, sample: ['Essay'] }] } });
    expect(api.state?.rows[0]).toMatchObject({ state: 'done', captured: 3 });
    await emit({ type: 'pullDone', runId: 'r1', cancelled: false, results: [] });
    expect(api.state?.phase).toBe('done');
  });

  it('a single refresh starts at once, with no confirmation step', async () => {
    await mount();
    await act(async () => api.refreshKind({ id: 1, name: 'Biology' }, 'grades', 'Grades'));
    await tick();
    expect(started[0]).toEqual([{ url: 'https://school.test/courses/1/grades', label: 'Biology · Grades' }]);
    expect(api.state?.phase).toBe('running');
  });

  it('pulls one pasted address on the student\'s Canvas and refuses another host', async () => {
    await mount();
    let error: string | null = 'unset';
    await act(async () => void (error = await api.pullAddress('https://evil.test/courses/1')));
    expect(error).toMatch(/not on your Canvas/);
    expect(started).toEqual([]);
    await act(async () => void (error = await api.pullAddress('/courses/1/announcements')));
    await tick();
    expect(error).toBeNull();
    expect(started[0][0].url).toBe('https://school.test/courses/1/announcements');
  });

  it('with no courses known, opens the dashboard first and then the courses, as one confirmed run', async () => {
    snapshot = snap([]);
    await mount();
    await act(async () => api.requestSync({ confirm: false, depth: 'essential', depthChoice: false }));
    await tick();
    expect(started).toHaveLength(1);
    expect(started[0].map((s) => s.label)).toEqual(['Dashboard']);
    // The dashboard brings the courses in.
    snapshot = withCourses;
    await emit({ type: 'pullProgress', runId: 'r1', index: 0, total: 1, step: started[0][0], state: 'done', outcome: { captured: 5 } });
    startReply = { ok: true, runId: 'r2', total: 4 };
    await emit({ type: 'pullDone', runId: 'r1', cancelled: false, results: [{ step: started[0][0], captured: 5 }] });
    await tick();
    expect(started).toHaveLength(2);
    expect(started[1]).toHaveLength(4);
    expect(api.state?.rows).toHaveLength(1 + 4);
    expect(api.state?.phase).toBe('running');
  });

  it('refuses a second run while one is going, and Stop cancels', async () => {
    await mount();
    await act(async () => api.refreshKind({ id: 1, name: 'Biology' }, 'grades', 'Grades'));
    await tick();
    await act(async () => api.refreshKind({ id: 1, name: 'Biology' }, 'units', 'Units'));
    expect(started).toHaveLength(1);
    expect(api.state?.message).toMatch(/already running/);
    await act(async () => api.stop());
    expect(cancelPull).toHaveBeenCalled();
    await emit({ type: 'pullDone', runId: 'r1', cancelled: true, results: [] });
    expect(api.state).toMatchObject({ phase: 'done', cancelled: true });
  });

  it('says what is wrong when there is no Canvas address, or the extension refuses', async () => {
    snapshot = snap([], null);
    await mount();
    await act(async () => api.requestSync({ confirm: false }));
    await tick();
    expect(api.state?.phase).toBe('done');
    expect(api.state?.message).toMatch(/Canvas address/);

    snapshot = withCourses;
    startReply = { ok: false, error: 'A sync is already running.' };
    await act(async () => api.close());
    await act(async () => api.refreshKind({ id: 1, name: 'Biology' }, 'grades', 'Grades'));
    await tick();
    expect(api.state?.message).toBe('A sync is already running.');
  });

  it('pulls the linked pages in batches of 80, skips opened ones, and says how many are left', async () => {
    const links = Array.from({ length: 85 }, (_, i) => `/courses/1/assignments/${i + 1}`);
    snapshot = snap([
      rec('dashboardCards', null, [{ id: '1', longName: 'Biology' }]),
      rec('assignmentGroups', 1, [{ id: '1', name: 'G', assignments: links.map((html_url, i) => ({ id: String(i + 1), name: `A${i + 1}`, html_url })) }]),
    ]);
    await mount();
    await act(async () => api.requestDeepSync());
    await tick();
    expect(api.state).toMatchObject({ phase: 'confirm', planCount: 80, planTotal: 85 });
    expect(document.body.textContent).toContain('85 pages found; this run opens the first 80');

    await act(async () => api.start());
    await tick();
    expect(started[0]).toHaveLength(80);
    expect(started[0][0].label).toBe('Biology · Assignment · A1');

    // The extension opened them, and remembers: the next batch is the rest.
    const visited = Object.fromEntries(started[0].map((s) => [s.url, Date.now()]));
    snapshot = { ...snapshot!, visited };
    await emit({ type: 'pullDone', runId: 'r1', cancelled: false, results: [] });
    await tick();
    expect(api.state?.phase).toBe('done');
    expect(api.state?.remaining).toBe(5);
    expect(document.body.textContent).toContain('5 more linked pages have not been opened yet');
  });

  it('cuts a plan that is longer than one run and says how long it really was; Start twice opens one run', async () => {
    const cards = Array.from({ length: 21 }, (_, i) => ({ id: String(i + 1), longName: `Course ${i + 1}` }));
    snapshot = snap([rec('dashboardCards', null, cards)]);
    await mount();
    await act(async () => api.requestSync());
    await tick();
    expect(api.state).toMatchObject({ phase: 'confirm', planCount: 200, planTotal: 4 + 21 * 10 });
    // A double click on Start must not start two runs.
    await act(async () => {
      api.start();
      api.start();
    });
    await tick();
    expect(started).toHaveLength(1);
    expect(started[0]).toHaveLength(200);
  });

  it('the popup\'s "Sync in Courseline" shows the plan in the open page, but not over a run that is going', async () => {
    await mount();
    await act(async () => planListeners.forEach((l) => l()));
    await tick();
    expect(api.state).toMatchObject({ phase: 'confirm', title: 'Sync your courses' });
    expect(started).toEqual([]); // it only asks; the student still presses Start

    await act(async () => api.start());
    await tick();
    expect(api.state?.phase).toBe('running');
    const title = api.state?.title;
    await act(async () => planListeners.forEach((l) => l()));
    expect(api.state).toMatchObject({ phase: 'running', title }); // untouched
  });

  it('starting from the confirmed plan does not read the whole store again', async () => {
    await mount();
    await act(async () => api.requestSync());
    await tick();
    const loadsAfterConfirm = snapshotLoads;
    expect(loadsAfterConfirm).toBeGreaterThan(0);
    await act(async () => api.start());
    await tick();
    expect(snapshotLoads).toBe(loadsAfterConfirm); // the plan on screen is the plan that runs
    expect(started).toHaveLength(1);
  });

  it('a Stop pressed between the dashboard and the courses is honoured: the second stage never starts', async () => {
    snapshot = snap([]);
    await mount();
    await act(async () => api.requestSync({ confirm: false, depth: 'essential', depthChoice: false }));
    await tick();
    expect(started).toHaveLength(1); // the dashboard
    await act(async () => api.stop());
    snapshot = withCourses; // the dashboard finished and brought the courses in...
    await emit({ type: 'pullDone', runId: 'r1', cancelled: false, results: [{ step: started[0][0], captured: 5 }] });
    await tick();
    expect(started).toHaveLength(1); // ...but the student had pressed Stop, so nothing more opens
    expect(api.state).toMatchObject({ phase: 'done', cancelled: true });
  });
});

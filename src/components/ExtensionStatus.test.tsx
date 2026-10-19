import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../extension/bridge';
import { ExtensionStatus } from './ExtensionStatus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const now = Date.now();
const rec = (kind: string, courseId: number | null, body: unknown, ageMs: number) => ({ kind, courseId, host: 'school.test', url: 'u', capturedAt: now - ageMs, body });
const snapshot: Snapshot = {
  records: [
    rec('dashboardCards', null, [{ id: '1', longName: 'Biology' }], 60e3),
    rec('assignmentGroups', 1, [], 5 * 60e3),
    rec('courseSubmissions', 1, [], 3 * 86400e3),
  ],
  health: {},
  appPinned: null,
  canvasHost: null,
  takenAt: now,
};

let auth: { source: string; snapshot: Snapshot | null } = { source: 'extension', snapshot };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
const pull = { requestSync: vi.fn(), refreshCourse: vi.fn(), refreshKind: vi.fn(), running: false };
vi.mock('../context/PullContext', () => ({ usePull: () => pull }));

async function render(path: string) {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><ExtensionStatus /></MemoryRouter>));
  return { text: () => el.textContent ?? '', items: () => [...el.querySelectorAll('li')].map((li) => li.textContent), unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  document.body.innerHTML = '';
  auth = { source: 'extension', snapshot };
});

describe('ExtensionStatus per-type freshness', () => {
  it('shows when each kind of data was updated, marks old data stale and missing core data not synced', async () => {
    const view = await render('/courses/1/grades');
    const items = view.items().join(' | ');
    expect(items).toContain('Assignments: 5 minutes ago');
    expect(items).toMatch(/Grades: 3 days ago · stale/);
    expect(items).toContain('Units: not synced yet');
    expect(items).toContain('Pages: not synced yet');
    await view.unmount();
  });

  it('shows account-wide types off a course page, and nothing at all outside extension mode', async () => {
    const view = await render('/');
    expect(view.items().join(' ')).toContain('Course info');
    await view.unmount();

    auth = { source: 'token', snapshot: null };
    const off = await render('/');
    expect(off.text()).toBe('');
    await off.unmount();
  });
});

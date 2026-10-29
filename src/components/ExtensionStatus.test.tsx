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

// The details are collapsed until opened; the tests below read them opened (as remembered on this browser).
async function render(path: string, opened = true) {
  localStorage.setItem('courseline.extension-status-open', opened ? '1' : '0');
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><ExtensionStatus /></MemoryRouter>));
  return {
    text: () => el.textContent ?? '',
    items: () => [...el.querySelectorAll('li')].map((li) => li.textContent),
    toggle: () => act(async () => (el.querySelector('button[aria-expanded]') as HTMLButtonElement).click()),
    expanded: () => el.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded'),
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  auth = { source: 'extension', snapshot };
});

describe('ExtensionStatus in the sidebar', () => {
  it('starts as one row with a status in words, and opens to the details (remembered)', async () => {
    const view = await render('/courses/1/grades', false);
    expect(view.expanded()).toBe('false');
    expect(view.text()).toContain('Extension');
    expect(view.text()).toMatch(/Out of date|Partly synced|Up to date|Needs attention|Not synced yet/);
    expect(view.items()).toEqual([]);
    await view.toggle();
    expect(view.expanded()).toBe('true');
    expect(view.items().join(' ')).toContain('Assignments');
    expect(localStorage.getItem('courseline.extension-status-open')).toBe('1');
    await view.unmount();
  });
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

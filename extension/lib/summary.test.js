import { describe, expect, it } from 'vitest';
import { ago, summarize } from './summary.js';

const NOW = 1_000_000_000_000;
const rec = (kind, courseId, ageMs, body = {}) => ({ kind, courseId, capturedAt: NOW - ageMs, body });

describe('ago', () => {
  it('formats each range', () => {
    expect(ago(NOW, NOW - 5e3)).toBe('just now');
    expect(ago(NOW, NOW - 5 * 60e3)).toBe('5 min ago');
    expect(ago(NOW, NOW - 3 * 3600e3)).toBe('3 h ago');
    expect(ago(NOW, NOW - 2 * 86400e3)).toBe('2 d ago');
  });
});

describe('summarize', () => {
  it('groups records per course with counts and the newest time, newest course first', () => {
    const s = summarize(
      {
        'cap:a': rec('assignments', 1, 60e3),
        'cap:b': rec('assignments', 1, 10e3),
        'cap:c': rec('modules', 2, 5 * 60e3),
        'cap:d': rec('courses', null, 1e3, [{ id: 1, name: 'Biology' }, { id: 2, name: 'History' }]),
        other: 'ignored',
      },
      NOW,
    );
    expect(s.total).toBe(4);
    expect(s.courses.map((c) => c.courseId)).toEqual([1, 2]);
    expect(s.courses[0]).toMatchObject({ name: 'Biology', kinds: { assignments: { count: 2, lastAt: NOW - 10e3 } } });
    expect(s.account.kinds.courses.count).toBe(1);
  });

  it('takes a name from a single course record and leaves it null when unknown', () => {
    const s = summarize({ 'cap:a': rec('course', 7, 1e3, { id: 7, name: 'Math' }), 'cap:b': rec('modules', 8, 1e3) }, NOW);
    expect(s.courses.find((c) => c.courseId === 7).name).toBe('Math');
    expect(s.courses.find((c) => c.courseId === 8).name).toBeNull();
  });

  it('marks data older than a day as stale', () => {
    const s = summarize({ 'cap:a': rec('modules', 1, 25 * 3600e3), 'cap:b': rec('modules', 2, 3600e3) }, NOW);
    expect(s.courses.find((c) => c.courseId === 1).stale).toBe(true);
    expect(s.courses.find((c) => c.courseId === 2).stale).toBe(false);
  });

  it('reports a type as failing only while its last unexpected response is newer than its last good one', () => {
    const s = summarize(
      {
        health: {
          assignments: { ok: 3, badShape: 2, lastOkAt: 100, lastBadAt: 200 },
          modules: { ok: 3, badShape: 1, lastOkAt: 300, lastBadAt: 200 },
          pages: { ok: 1, badShape: 0, lastOkAt: 1, lastBadAt: null },
        },
      },
      NOW,
    );
    expect(s.failing).toEqual(['assignments']);
  });

  it('lists unread addresses, most frequent first', () => {
    const s = summarize({ unmapped: { 'GET /a': { count: 2, lastAt: 1 }, 'GET /b': { count: 9, lastAt: 1 } } }, NOW);
    expect(s.unmapped.map((u) => u.address)).toEqual(['GET /b', 'GET /a']);
  });

  it('measures coverage against the pinned (dashboard) courses only, and hides the rest', () => {
    const cards = [{ id: '1', longName: 'Bio' }, { id: '2', longName: 'Hist' }];
    const s = summarize(
      {
        'cap:d': rec('dashboardCards', null, 1e3, cards),
        'cap:a': rec('assignments', 1, 1e3),
        'cap:x': rec('assignments', 9, 1e3), // a course that is not pinned
      },
      NOW,
    );
    expect(s.coverage).toMatchObject({ total: 2, synced: 1 });
    expect(s.coverage.missing).toEqual([{ id: 2, name: 'Hist', concluded: false }]);
    expect(s.courses.map((c) => c.courseId)).toEqual([1]);
  });

  it('uses the courses chosen in the app over the dashboard', () => {
    const s = summarize(
      {
        appPinned: [2],
        'cap:d': rec('dashboardCards', null, 1e3, [{ id: '1', longName: 'Bio' }]),
        'cap:a': rec('assignments', 1, 1e3),
        'cap:b': rec('assignments', 2, 1e3),
        'cap:c': rec('course', 2, 1e3, { id: 2, name: 'History' }),
      },
      NOW,
    );
    expect(s.coverage).toMatchObject({ total: 1, synced: 1 });
    expect(s.courses.map((c) => c.courseId)).toEqual([2]);
  });

  it('has no coverage figure until the course list has been seen', () => {
    expect(summarize({ 'cap:a': rec('assignments', 1, 1e3) }, NOW).coverage).toBeNull();
    // A full course list alone is not enough: pinned means what is on the dashboard.
    const list = { data: { legacyNode: { enrollments: [{ concluded: false, course: { _id: '1', contextName: 'Bio' } }] } } };
    expect(summarize({ 'cap:l': rec('GetUserCourses', null, 1e3, list) }, NOW).coverage).toBeNull();
  });

  it('copes with empty storage', () => {
    expect(summarize({}, NOW)).toMatchObject({ total: 0, unmapped: [], courses: [], account: null, health: [], failing: [] });
  });
});

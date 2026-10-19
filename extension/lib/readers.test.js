import { describe, expect, it } from 'vitest';
import { knownCourses, pinnedCourses, readCourseList, readDashboardCards, readUserCourses } from './readers.js';

const enr = (id, name, concluded = false) => ({ concluded, type: 'StudentEnrollment', course: { _id: String(id), contextName: name } });

describe('readUserCourses', () => {
  it('reads ids as numbers, one entry per course, current if any enrollment is open', () => {
    const out = readUserCourses({ data: { legacyNode: { enrollments: [enr(1, 'Bio'), enr(2, 'Old', true), enr(2, 'Old', false), enr(3, 'Hist', true)] } } });
    expect(out).toEqual([
      { id: 1, name: 'Bio', concluded: false },
      { id: 2, name: 'Old', concluded: false },
      { id: 3, name: 'Hist', concluded: true },
    ]);
  });

  it('returns null for any other shape and skips entries without a usable id', () => {
    expect(readUserCourses({ data: {} })).toBeNull();
    expect(readUserCourses(null)).toBeNull();
    expect(readUserCourses({ data: { legacyNode: { enrollments: [{ course: {} }, enr('x', 'Bad')] } } })).toEqual([]);
  });
});

describe('readDashboardCards', () => {
  it('reads the course id from the card, or from its asset string', () => {
    const out = readDashboardCards([{ id: '5', longName: 'Biology 101' }, { assetString: 'course_6', shortName: 'Hist' }, { nope: 1 }]);
    expect(out).toEqual([
      { id: 5, name: 'Biology 101', concluded: false },
      { id: 6, name: 'Hist', concluded: false },
    ]);
  });

  it('returns null for a non-list', () => {
    expect(readDashboardCards({})).toBeNull();
  });
});

describe('knownCourses', () => {
  const list = { kind: 'GetUserCourses', capturedAt: 10, body: { data: { legacyNode: { enrollments: [enr(1, 'Bio'), enr(2, 'Old', true)] } } } };
  const cards = { kind: 'dashboardCards', capturedAt: 20, body: [{ id: '2', longName: 'Old (again)' }, { id: '9', longName: 'New' }] };

  it('works from the dashboard cards alone', () => {
    const out = knownCourses([cards]);
    expect(out.courses.map((c) => c.id)).toEqual([2, 9]);
    expect(out.asOf).toBe(20);
  });

  it('works from the full list alone, keeping concluded courses', () => {
    expect(knownCourses([list]).courses).toEqual([{ id: 1, name: 'Bio', concluded: false }, { id: 2, name: 'Old', concluded: true }]);
  });

  it('merges them, treating anything on the dashboard as current', () => {
    const out = knownCourses([list, cards]).courses;
    expect(out.find((c) => c.id === 2)).toMatchObject({ concluded: false });
    expect(out.map((c) => c.id).sort()).toEqual([1, 2, 9]);
  });

  it('returns null when neither has been seen', () => {
    expect(knownCourses([{ kind: 'course', capturedAt: 1, body: {} }])).toBeNull();
  });
});

describe('readCourseList', () => {
  it('marks completed courses as concluded and skips hidden stubs', () => {
    const out = readCourseList([
      { id: 1, name: 'Bio', workflow_state: 'available', enrollments: [{ enrollment_state: 'active' }] },
      { id: 2, name: 'Old', workflow_state: 'completed', enrollments: [] },
      { id: 3, name: 'Ended', workflow_state: 'available', enrollments: [{ enrollment_state: 'completed' }] },
      { id: 4, access_restricted_by_date: true },
    ]);
    expect(out).toEqual([
      { id: 1, name: 'Bio', concluded: false },
      { id: 2, name: 'Old', concluded: true },
      { id: 3, name: 'Ended', concluded: true },
    ]);
  });

  it('is used by knownCourses, and a dashboard card still wins for current', () => {
    const rest = { kind: 'userCourses', capturedAt: 5, body: [{ id: 1, name: 'Bio', workflow_state: 'completed' }, { id: 2, name: 'Hist', workflow_state: 'available' }] };
    const cards = { kind: 'dashboardCards', capturedAt: 6, body: [{ id: '1', longName: 'Bio' }] };
    expect(knownCourses([rest]).courses).toEqual([{ id: 1, name: 'Bio', concluded: true }, { id: 2, name: 'Hist', concluded: false }]);
    expect(knownCourses([rest, cards]).courses.find((c) => c.id === 1).concluded).toBe(false);
  });
});

describe('pinnedCourses', () => {
  it('is the newest dashboard, and null until one has been seen', () => {
    const old = { kind: 'dashboardCards', capturedAt: 1, body: [{ id: '1', longName: 'Old' }] };
    const fresh = { kind: 'dashboardCards', capturedAt: 9, body: [{ id: '2', longName: 'Hist' }] };
    expect(pinnedCourses([old, fresh]).map((c) => c.id)).toEqual([2]);
    expect(pinnedCourses([{ kind: 'userCourses', capturedAt: 1, body: [] }])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { effectivePinnedIds, pinnedList } from './pinned.js';

const cards = { kind: 'dashboardCards', capturedAt: 5, body: [{ id: '1', longName: 'Bio (dashboard)' }] };
const course2 = { kind: 'course', courseId: 2, capturedAt: 1, body: { id: 2, name: 'History' } };

describe('effectivePinnedIds', () => {
  it('prefers the courses chosen in the app, then the dashboard, else nothing is known', () => {
    expect(effectivePinnedIds({ appPinned: [2], pinned: [1] })).toEqual([2]);
    expect(effectivePinnedIds({ appPinned: [], pinned: [1] })).toEqual([1]);
    expect(effectivePinnedIds({ pinned: [1] })).toEqual([1]);
    expect(effectivePinnedIds({})).toBeNull();
  });
});

describe('pinnedList', () => {
  it('uses the app\'s choice with names from what was captured', () => {
    expect(pinnedList({ appPinned: [2, 7] }, [cards, course2])).toEqual([
      { id: 2, name: 'History', concluded: false },
      { id: 7, name: null, concluded: false },
    ]);
  });

  it('falls back to the dashboard cards, and is null when neither is known', () => {
    expect(pinnedList({}, [cards]).map((c) => c.id)).toEqual([1]);
    expect(pinnedList({}, [course2])).toBeNull();
  });
});

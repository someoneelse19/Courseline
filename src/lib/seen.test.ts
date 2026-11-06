import { beforeEach, describe, expect, it } from 'vitest';
import { isNew, markSeen, resetSeen, type SeenRecord } from './seen';

beforeEach(() => {
  localStorage.clear();
  resetSeen();
});

const record = (ids: number[], since = Date.parse('2026-10-20T00:00:00Z')): SeenRecord => ({ ids, since });

describe('isNew', () => {
  it('is new when not seen here, unless Canvas says it was read there', () => {
    expect(isNew({ id: 3 }, record([1, 2]))).toBe(true);
    expect(isNew({ id: 2 }, record([1, 2]))).toBe(false);
    expect(isNew({ id: 3, read_state: 'read' }, record([1, 2]))).toBe(false);
  });

  it('an item dated before the record started was already there (it only turned up late), unless Canvas says unread', () => {
    expect(isNew({ id: 3, date: '2026-10-01T00:00:00Z' }, record([1]))).toBe(false);
    expect(isNew({ id: 3, date: '2026-10-25T00:00:00Z' }, record([1]))).toBe(true);
    expect(isNew({ id: 3, date: '2026-10-01T00:00:00Z', read_state: 'unread' }, record([1]))).toBe(true);
  });

  it('before anything is recorded, only what Canvas says is unread is new', () => {
    expect(isNew({ id: 3 }, undefined)).toBe(false);
    expect(isNew({ id: 3, read_state: 'unread' }, undefined)).toBe(true);
  });
});

describe('markSeen', () => {
  it('keeps what was seen per course and kind, in this browser, and when it started', () => {
    markSeen(5, 'assignments', [1, 2], 1000);
    markSeen(5, 'assignments', [3], 2000);
    markSeen(6, 'announcements', [9], 3000);
    expect(JSON.parse(localStorage.getItem('courseline.seen')!)).toEqual({
      '5:assignments': { ids: [1, 2, 3], since: 1000 },
      '6:announcements': { ids: [9], since: 3000 },
    });
  });

  it('records an empty list too, so later items count as new', () => {
    markSeen(5, 'announcements', [], 1000);
    expect(JSON.parse(localStorage.getItem('courseline.seen')!)['5:announcements']).toEqual({ ids: [], since: 1000 });
  });
});

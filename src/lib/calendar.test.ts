import { describe, expect, it } from 'vitest';
import { dateKey, monthGrid } from './calendar';

describe('monthGrid', () => {
  it('fills whole weeks starting on Sunday', () => {
    const days = monthGrid(2026, 9, 0); // October 2026 starts on a Thursday
    expect(days.length % 7).toBe(0);
    expect(days[0].getDay()).toBe(0);
    expect(dateKey(days[0])).toBe('2026-09-27');
    expect(dateKey(days[days.length - 1])).toBe('2026-10-31');
  });

  it('can start weeks on Monday', () => {
    const days = monthGrid(2026, 9, 1);
    expect(days[0].getDay()).toBe(1);
    expect(dateKey(days[0])).toBe('2026-09-28');
  });

  it('uses only as many weeks as the month needs', () => {
    expect(monthGrid(2026, 1, 0)).toHaveLength(28); // Feb 2026 starts on a Sunday and has 28 days
    expect(monthGrid(2026, 7, 0)).toHaveLength(42); // Aug 2026 spans six weeks
  });

  it('rolls over the year', () => {
    expect(dateKey(monthGrid(2026, 11, 0).at(-1)!)).toBe('2027-01-02');
  });
});

describe('dateKey', () => {
  it('uses the local calendar day', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

import { describe, expect, it } from 'vitest';
import { buildCourseColors, colorAt } from './courseColor';

describe('course colors', () => {
  it('never gives two courses the same color, however many there are', () => {
    for (const n of [1, 6, 12, 13, 40, 200]) {
      expect(new Set(Array.from({ length: n }, (_, i) => colorAt(i))).size).toBe(n);
    }
  });

  it('does not depend on the order the courses arrive in', () => {
    expect(buildCourseColors([30, 10, 20])).toEqual(buildCourseColors([10, 20, 30]));
  });

  it('gives each course id exactly one distinct color', () => {
    const ids = [501, 7, 99, 7, 1234];
    const map = buildCourseColors(ids);
    expect(map.size).toBe(4); // the repeated id counts once
    expect(new Set(map.values()).size).toBe(4);
  });

  it('keeps an existing course\'s color when a course with a higher id is added', () => {
    const before = buildCourseColors([1, 2, 3]);
    const after = buildCourseColors([1, 2, 3, 4]);
    for (const [id, color] of before) expect(after.get(id)).toBe(color);
  });
});

import { describe, expect, it } from 'vitest';
import { orderCourses } from './CourseFilterContext';

const courses = (...ids: number[]) => ids.map((id) => ({ id }));
const ids = (list: Array<{ id: number }>) => list.map((c) => c.id);

describe('orderCourses', () => {
  it('puts the courses in the order the student chose', () => {
    expect(ids(orderCourses(courses(1, 2, 3), [3, 1, 2]))).toEqual([3, 1, 2]);
  });

  it('keeps courses the order does not mention after the ordered ones, as they came', () => {
    expect(ids(orderCourses(courses(5, 1, 4, 2), [2, 1]))).toEqual([2, 1, 5, 4]);
  });

  it('ignores ids that are not in the list, and leaves the list alone with no order', () => {
    expect(ids(orderCourses(courses(1, 2), [9, 2, 1]))).toEqual([2, 1]);
    expect(ids(orderCourses(courses(2, 1), null))).toEqual([2, 1]);
  });
});

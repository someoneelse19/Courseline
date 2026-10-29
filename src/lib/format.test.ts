import { describe, expect, it } from 'vitest';
import type { Course } from '../api/types';
import { courseIdFromContext, formatAgoShort, formatBytes, formatGrade, getGrade } from './format';

const course = (enrollments: Course['enrollments']): Course => ({ id: 1, name: 'C', enrollments });

describe('grades', () => {
  it('reads the student enrollment and formats percent and letter', () => {
    const g = getGrade(course([{ type: 'student', enrollment_state: 'active', computed_current_score: 92.44, computed_current_grade: 'A-' }]));
    expect(formatGrade(g)).toBe('92.4% (A-)');
  });
  it('shows a dash, never 0%, when Canvas hides or has no grade', () => {
    expect(formatGrade(getGrade(course([{ type: 'student', enrollment_state: 'active', computed_current_score: null }])))).toBe('—');
    expect(formatGrade(getGrade(course(undefined)))).toBe('—');
  });
  it('ignores non-student enrollments', () => {
    expect(getGrade(course([{ type: 'teacher', enrollment_state: 'active', computed_current_score: 99 }])).score).toBeNull();
  });
});

describe('small helpers', () => {
  it('formatBytes', () => {
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('courseIdFromContext', () => {
    expect(courseIdFromContext('course_123')).toBe(123);
    expect(courseIdFromContext('user_5')).toBeNull();
    expect(courseIdFromContext(undefined)).toBeNull();
  });
});

describe('formatAgoShort', () => {
  it('is short enough for the sidebar', () => {
    const now = Date.parse('2026-10-28T10:00:00Z');
    expect(formatAgoShort(now - 9 * 60e3, now)).toMatch(/^9\s?min/);
    expect(formatAgoShort(now - 3 * 3600e3, now)).toMatch(/^3\s?hr/);
    expect(formatAgoShort(now - 2 * 86400e3, now)).toMatch(/^2\s?days?/);
  });
});

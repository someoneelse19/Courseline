import { describe, expect, it } from 'vitest';
import { dashboardStep, estimateSeconds, planCourse, planSync, stepForAddress, stepsForKind } from './pullPlan';

const bio = { id: 1, name: 'Biology' };
const unnamed = { id: 3, name: null };

describe('planSync', () => {
  it('essential: four pages per course and nothing else', () => {
    const steps = planSync('h.test', [bio, unnamed], 'essential');
    expect(steps.map((s) => s.url)).toEqual([
      'https://h.test/courses/1/assignments',
      'https://h.test/courses/1/grades',
      'https://h.test/courses/1/modules',
      'https://h.test/courses/1/pages',
      'https://h.test/courses/3/assignments',
      'https://h.test/courses/3/grades',
      'https://h.test/courses/3/modules',
      'https://h.test/courses/3/pages',
    ]);
    expect(steps[4].label).toBe('Course 3 · Assignments');
  });

  it('everything (the default): the account pages once, then ten pages per course', () => {
    const steps = planSync('h.test', [bio, unnamed]);
    expect(steps.slice(0, 4).map((s) => s.url)).toEqual(['https://h.test/courses', 'https://h.test/grades', 'https://h.test/calendar', 'https://h.test/conversations']);
    expect(steps).toHaveLength(4 + 2 * 10);
    expect(planCourse('h.test', bio).map((s) => s.url.replace('https://h.test/courses/1/', ''))).toContain('assignments/syllabus');
  });

  it('plans no account pages when there are no courses, and has a dashboard step', () => {
    expect(planSync('h.test', [])).toEqual([]);
    expect(dashboardStep('h.test')).toEqual({ url: 'https://h.test/', label: 'Dashboard' });
  });
});

describe('stepsForKind', () => {
  it('maps each kind of data to the page that loads it', () => {
    expect(stepsForKind('h.test', bio, 'grades', 'Grades')).toEqual([{ url: 'https://h.test/courses/1/grades', label: 'Biology · Grades' }]);
    expect(stepsForKind('h.test', bio, 'units', 'Units')[0].url).toBe('https://h.test/courses/1/modules');
    expect(stepsForKind('h.test', bio, 'course', 'Course info')[0].url).toBe('https://h.test/courses/1');
    expect(stepsForKind('h.test', null, 'upcoming', 'Upcoming work')[0].url).toBe('https://h.test/calendar');
  });

  it('has nothing for a kind that does not apply there', () => {
    expect(stepsForKind('h.test', bio, 'upcoming', 'Upcoming work')).toEqual([]);
    expect(stepsForKind('h.test', null, 'files', 'Files')).toEqual([]);
  });
});

describe('stepForAddress', () => {
  it('accepts a full address, a bare host path, or a path, only on the student\'s Canvas', () => {
    expect(stepForAddress('h.test', 'https://h.test/courses/1/grades?x=1')).toMatchObject({ ok: true, step: { url: 'https://h.test/courses/1/grades?x=1' } });
    expect(stepForAddress('h.test', '/courses/2/announcements')).toMatchObject({ ok: true, step: { url: 'https://h.test/courses/2/announcements' } });
    expect(stepForAddress('h.test', 'H.test/calendar')).toMatchObject({ ok: true });
  });

  it('refuses other hosts, http, credentials and nonsense', () => {
    expect(stepForAddress('h.test', 'https://evil.test/courses/1')).toMatchObject({ ok: false });
    expect(stepForAddress('h.test', 'http://h.test/courses/1')).toMatchObject({ ok: false });
    expect(stepForAddress('h.test', 'https://me:pw@h.test/')).toMatchObject({ ok: false });
    expect(stepForAddress('h.test', '   ')).toMatchObject({ ok: false });
    expect(stepForAddress('h.test', 'javascript:alert(1)')).toMatchObject({ ok: false });
  });
});

describe('estimateSeconds', () => {
  it('scales with the number of pages', () => {
    expect(estimateSeconds(10)).toBeGreaterThan(estimateSeconds(1));
  });
});

import { describe, expect, it } from 'vitest';
import { checkedInstant, checkedNumber, checkedStatistics, dedupeIssues, issueSummary, looksLikeAssignmentOf, normalizeInstant, sensibleStatistics, type ValueIssue } from './valueChecks';

const collect = () => {
  const issues: ValueIssue[] = [];
  return { issues, sink: (i: ValueIssue) => issues.push(i) };
};

describe('normalizeInstant', () => {
  it('keeps UTC Z strings exactly as they are', () => {
    for (const v of ['2026-10-20T09:15:00Z', '2026-10-20T09:15:00.123Z', '2026-10-20T09:15Z']) expect(normalizeInstant(v)).toEqual({ ok: true, value: v });
  });

  it('converts an offset to UTC Z (2026-10-20T11:15:00+02:00 → 2026-10-20T09:15:00Z)', () => {
    expect(normalizeInstant('2026-10-20T11:15:00+02:00')).toEqual({ ok: true, value: '2026-10-20T09:15:00Z' });
    expect(normalizeInstant('2026-10-20T11:15:00+0200')).toEqual({ ok: true, value: '2026-10-20T09:15:00Z' });
    expect(normalizeInstant('2026-10-19T23:59:59-06:00')).toEqual({ ok: true, value: '2026-10-20T05:59:59Z' });
    expect(normalizeInstant('2026-10-20T11:15:00.5+01:00')).toEqual({ ok: true, value: '2026-10-20T10:15:00.500Z' });
  });

  it('treats null, undefined and "" as unknown, not a problem', () => {
    for (const v of [null, undefined, '']) expect(normalizeInstant(v)).toEqual({ ok: true, value: null });
  });

  it('refuses date-only, no time zone, localized text ("20 de oct a las 11:15") and years outside 2000-2100', () => {
    expect(normalizeInstant('2026-10-20')).toEqual({ ok: false, reason: 'not a date' });
    expect(normalizeInstant('2026-10-20T11:15:00')).toEqual({ ok: false, reason: 'no time zone' });
    expect(normalizeInstant('20 de oct a las 11:15')).toEqual({ ok: false, reason: 'not a date' });
    expect(normalizeInstant('1970-01-01T00:00:00Z')).toEqual({ ok: false, reason: 'year out of range' });
    expect(normalizeInstant('2126-10-20T11:15:00Z')).toEqual({ ok: false, reason: 'year out of range' });
    expect(normalizeInstant('2026-13-45T11:15:00Z')).toEqual({ ok: false, reason: 'not a date' });
    expect(normalizeInstant(1760000000000)).toEqual({ ok: false, reason: 'not a date' });
  });
});

describe('checkedInstant', () => {
  it('reports what it dropped, with course, item and field', () => {
    const { issues, sink } = collect();
    expect(checkedInstant('2026-10-20T11:15:00+02:00', { courseId: 4, itemId: 41, item: 'Ecuaciones', field: 'due_at' }, sink)).toBe('2026-10-20T09:15:00Z');
    expect(checkedInstant(null, { courseId: 4, field: 'due_at' }, sink)).toBeNull();
    expect(issues).toEqual([]);
    expect(checkedInstant('20 de oct', { courseId: 4, itemId: 41, item: 'Ecuaciones', field: 'due_at' }, sink)).toBeUndefined();
    expect(issues).toEqual([{ kind: 'date', courseId: 4, itemId: 41, item: 'Ecuaciones', field: 'due_at', value: '20 de oct', reason: 'not a date' }]);
  });
});

describe('checkedNumber', () => {
  it('accepts finite numbers, including negatives and 0, and dot-decimal strings', () => {
    const { issues, sink } = collect();
    const ctx = { field: 'points_possible' };
    expect([10, 0, -2, 8.5].map((v) => checkedNumber(v, ctx, sink))).toEqual([10, 0, -2, 8.5]);
    expect(['10', '8.5', '-1'].map((v) => checkedNumber(v, ctx, sink))).toEqual([10, 8.5, -1]);
    expect(issues).toEqual([]);
  });

  it('treats "" and null as unknown, never 0', () => {
    const { issues, sink } = collect();
    expect(checkedNumber('', { field: 'score' }, sink)).toBeNull();
    expect(checkedNumber(null, { field: 'score' }, sink)).toBeNull();
    expect(checkedNumber(undefined, { field: 'score' }, sink)).toBeNull();
    expect(issues).toEqual([]);
  });

  it('refuses "8,5", NaN and Infinity and reports them', () => {
    const { issues, sink } = collect();
    for (const v of ['8,5', NaN, Infinity, '10 pts', true]) expect(checkedNumber(v, { courseId: 1, itemId: 5, field: 'score' }, sink)).toBeUndefined();
    expect(issues.map((i) => [i.kind, i.field, i.value])).toEqual([
      ['number', 'score', '8,5'],
      ['number', 'score', NaN],
      ['number', 'score', Infinity],
      ['number', 'score', '10 pts'],
      ['number', 'score', true],
    ]);
  });
});

describe('class statistics', () => {
  it('keeps legitimate extra credit (median 11, max 20 on 10 points) without an issue', () => {
    const { issues, sink } = collect();
    const stats = { min: 2, lower_q: 8, median: 11, upper_q: 14, max: 20, mean: 11 };
    expect(checkedStatistics(stats, 10, { field: 'score_statistics' }, sink)).toBe(stats);
    expect(sensibleStatistics(stats, 10)).toBe(stats);
    expect(issues).toEqual([]);
  });

  it('keeps a small bonus item\'s real extra credit (median 2, high 3 on 1 point) without an issue', () => {
    const { issues, sink } = collect();
    const stats = { min: 0, lower_q: 1, median: 2, upper_q: 2, max: 3, mean: 1.9 };
    expect(checkedStatistics(stats, 1, { field: 'score_statistics' }, sink)).toBe(stats);
    expect(issues).toEqual([]);
  });

  it('drops a misread by a factor of 10 too (median 68.8, high 100 on 10 points)', () => {
    const { issues, sink } = collect();
    expect(checkedStatistics({ min: 0, lower_q: 37.5, median: 68.8, upper_q: 95.6, max: 100, mean: 61.7 }, 10, { field: 'score_statistics' }, sink)).toBeUndefined();
    expect(issues).toHaveLength(1);
  });

  it('drops and reports statistics misread by a factor (688 on a 10-point assignment)', () => {
    const { issues, sink } = collect();
    const stats = { min: 0, lower_q: 375, median: 688, upper_q: 956, max: 1000, mean: 617 };
    expect(checkedStatistics(stats, 10, { courseId: 1, itemId: 5, item: 'Set 1', field: 'score_statistics' }, sink)).toBeUndefined();
    expect(issues).toEqual([{ kind: 'statistics', courseId: 1, itemId: 5, item: 'Set 1', field: 'score_statistics', value: stats, reason: 'out of order or out of scale' }]);
  });

  it('raises nothing when there were no statistics', () => {
    const { issues, sink } = collect();
    expect(checkedStatistics(undefined, 10, { field: 'score_statistics' }, sink)).toBeUndefined();
    expect(checkedStatistics(null, 10, { field: 'score_statistics' }, sink)).toBeUndefined();
    expect(issues).toEqual([]);
  });
});

describe('looksLikeAssignmentOf', () => {
  it('accepts a GraphQL assignment with no __typename (the shape Canvas sends)', () => {
    expect(looksLikeAssignmentOf({ _id: '41', name: 'Ecuaciones', description: '<p>x</p>', dueAt: '2026-10-20T09:15:00Z' }, 4, 41)).toBe(true);
    expect(looksLikeAssignmentOf({ __typename: 'Assignment', _id: '41', name: 'Ecuaciones', htmlUrl: 'https://s/courses/4/assignments/41' }, 4, 41)).toBe(true);
    expect(looksLikeAssignmentOf({ id: '41', name: 'Ecuaciones', course_id: '4' }, 4, 41)).toBe(true);
  });

  it('refuses a user, a module, a folder, a group, a course, a calendar event or another course\'s assignment with the same id', () => {
    const others = [
      { __typename: 'User', _id: '41', name: 'Ana' },
      { id: '41', name: 'Ana López', sortable_name: 'López, Ana', short_name: 'Ana' },
      { id: '41', name: 'Unit 1', items_count: 3 },
      { id: '41', name: 'course files', folders_count: 2, full_name: 'course files' },
      { id: '41', name: 'Homework', group_weight: 40 },
      { id: '41', name: 'Álgebra', course_code: 'ALG' },
      { id: '41', title: 'Exam', name: 'Exam', start_at: '2026-10-20T09:00:00Z', end_at: '2026-10-20T10:00:00Z' },
      { id: '41', name: 'Ecuaciones', html_url: 'https://s/courses/9/assignments/41' },
      { id: '41', name: 'Ecuaciones', course_id: '9' },
      { id: '41', name: 'Ecuaciones', html_url: 'https://s/courses/4/assignments/410' },
    ];
    for (const o of others) expect(looksLikeAssignmentOf(o, 4, 41), JSON.stringify(o)).toBe(false);
  });
});

describe('dedupeIssues and issueSummary', () => {
  it('one line per course and kind, at most four, then "and N more"', () => {
    const i = (kind: ValueIssue['kind'], courseId: number, itemId: number, item?: string): ValueIssue => ({ kind, courseId, itemId, item, field: kind === 'date' ? 'due_at' : 'x', value: null, reason: 'r' });
    const list = dedupeIssues([
      i('date', 1, 5, 'Lab'),
      i('date', 1, 5, 'Lab'), // the same value, read twice
      i('date', 1, 6, 'Essay'),
      i('date', 1, 7, 'Quiz'),
      i('date', 1, 8, 'Final'),
      i('statistics', 1, 5, 'Lab'),
      i('number', 2, 9),
      i('rubric', 3, 10, 'Report'),
      i('date', 4, 11, 'Other course'),
    ]);
    expect(list).toHaveLength(8);
    const names = new Map<number, string | null>([[1, 'Biology'], [2, 'History'], [3, null]]);
    expect(issueSummary(list, names)).toEqual({
      lines: ['Biology · dates: Lab, Essay, Quiz, …', 'Biology · class statistics: Lab', 'History · points or scores: #9', '#3 · rubric: Report'],
      more: 1,
    });
    expect(issueSummary(list, names, 10).more).toBe(0);
  });
});

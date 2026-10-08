import { describe, expect, it } from 'vitest';
import type { Assignment } from '../api/types';
import { assignmentStatus } from '../components/AssignmentList';
import { assignmentDate, assignmentTone, isDone, isFaded, sortAssignments, TONE_CLASSES } from './assignmentState';

const DAY = 86_400_000;
const make = (submission: Partial<NonNullable<Assignment['submission']>> | undefined, dueOffsetDays: number): Assignment =>
  ({
    id: 1,
    course_id: 1,
    name: 'A',
    due_at: new Date(Date.now() + dueOffsetDays * DAY).toISOString(),
    points_possible: 10,
    html_url: '',
    submission: submission && { workflow_state: 'unsubmitted', ...submission },
  }) as Assignment;

describe('assignmentTone', () => {
  it('is red for missing work', () => expect(assignmentTone(make({ missing: true }, -2))).toBe('missing'));
  it('is blue for work still to do, past due or not', () => {
    expect(assignmentTone(make({}, 3))).toBe('todo');
    expect(assignmentTone(make(undefined, -1))).toBe('todo');
    expect(assignmentTone(make({}, -1))).toBe('todo');
  });
  it('is green once handed in, graded or excused', () => {
    expect(assignmentTone(make({ workflow_state: 'submitted' }, 3))).toBe('done');
    expect(assignmentTone(make({ workflow_state: 'pending_review' }, 3))).toBe('done');
    expect(assignmentTone(make({ workflow_state: 'graded' }, -3))).toBe('done');
    expect(assignmentTone(make({ excused: true }, -3))).toBe('done');
  });
});

describe('isFaded', () => {
  it('fades only finished work whose due date has passed', () => {
    expect(isFaded(make({ workflow_state: 'submitted' }, -2))).toBe(true);
    expect(isFaded(make({ workflow_state: 'submitted' }, 2))).toBe(false); // handed in early, due later
    expect(isFaded(make({ missing: true }, -2))).toBe(false);
    expect(isFaded(make({}, -2))).toBe(false);
  });
});

describe('isDone', () => {
  it('is false without a submission', () => expect(isDone(make(undefined, 1))).toBe(false));
});

describe('assignmentStatus badges use the same colors as the calendar', () => {
  it.each([
    ['missing', make({ missing: true }, -2)],
    ['todo', make({}, 3)],
    ['todo', make({}, -3)], // past due but not marked missing: still blue, labelled "Past due"
    ['done', make({ workflow_state: 'submitted' }, 3)],
    ['done', make({ workflow_state: 'graded', score: 8 }, -3)],
    ['done', make({ excused: true }, -3)],
  ] as const)('%s', (tone, a) => expect(assignmentStatus(a).className).toBe(TONE_CLASSES[tone]));
});

describe('sortAssignments', () => {
  const NOW = Date.parse('2026-10-08T12:00:00Z');
  const at = (name: string, iso: string | null, extra: Partial<Assignment> = {}) =>
    ({ id: name.length * 31 + name.charCodeAt(0), course_id: 1, name, due_at: iso, points_possible: 1, html_url: '', ...extra }) as Assignment;
  const names = (list: Assignment[]) => sortAssignments(list, NOW).map((a) => a.name);

  it('puts upcoming work first (soonest first), then past work (most recent first)', () => {
    const list = [at('old', '2026-09-01T00:00:00Z'), at('later', '2026-10-20T00:00:00Z'), at('recent', '2026-10-07T00:00:00Z'), at('soon', '2026-10-09T00:00:00Z')];
    expect(names(list)).toEqual(['soon', 'later', 'recent', 'old']);
  });

  it('places an undated assignment by its post date, and fully undated ones last', () => {
    const list = [at('none', null), at('posted-soon', null, { created_at: '2026-10-10T00:00:00Z' }), at('due', '2026-10-15T00:00:00Z')];
    expect(names(list)).toEqual(['posted-soon', 'due', 'none']);
    expect(assignmentDate(list[1])).toBe('2026-10-10T00:00:00Z');
  });

  it('prefers the due date over the post date, and does not change the input', () => {
    const a = at('a', '2026-10-09T00:00:00Z', { created_at: '2026-01-01T00:00:00Z' });
    expect(assignmentDate(a)).toBe('2026-10-09T00:00:00Z');
    const input = [at('x', null), a];
    sortAssignments(input, NOW);
    expect(input.map((i) => i.name)).toEqual(['x', 'a']);
  });
});

import { describe, expect, it } from 'vitest';
import type { AssignmentGroup } from '../api/types';
import { computeGrade, gradeTrend, neededAverage, toModel, type GradeGroup, type GradeItem } from './grades';

let nextId = 1;
const group = (id: number, weight: number, o: Partial<GradeGroup> = {}): GradeGroup => ({ id, name: `G${id}`, weight, position: id, dropLowest: 0, dropHighest: 0, neverDrop: [], ...o });
const item = (groupId: number, points: number, score: number | null, o: Partial<GradeItem> = {}): GradeItem => ({
  id: nextId++, groupId, name: `I${nextId}`, dueAt: null, points, score, excused: false, omitted: false, gradedAt: null, ...o,
});

describe('computeGrade: weights', () => {
  const groups = [group(1, 40), group(2, 60)];
  // A (40%): 8/10 + 9/10 = 85%.  B (60%): 30/50 = 60%.  =>  0.4*85 + 0.6*60 = 70
  const graded = () => [item(1, 10, 8), item(1, 10, 9), item(2, 50, 30)];

  it('weights group percentages', () => {
    const r = computeGrade(groups, graded(), { weighted: true });
    expect(r.current).toBeCloseTo(70);
    expect(r.final).toBeCloseTo(70);
  });

  it('ignores ungraded work in "current" but counts it as 0 in "final"', () => {
    const r = computeGrade(groups, [...graded(), item(2, 10, null)], { weighted: true });
    expect(r.current).toBeCloseTo(70);
    expect(r.final).toBeCloseTo(64); // B becomes 30/60 = 50%  ->  0.4*85 + 0.6*50
  });

  it('rescales over only the groups that have graded work', () => {
    const r = computeGrade([group(1, 30), group(2, 70)], [item(1, 10, 9), item(2, 10, null)], { weighted: true });
    expect(r.current).toBeCloseTo(90);
    expect(r.final).toBeCloseTo(27); // 0.3*90 + 0.7*0
  });

  it('falls back to the plain points total when every weight is 0', () => {
    expect(computeGrade([group(1, 0), group(2, 0)], [item(1, 10, 5), item(2, 10, 10)], { weighted: true }).current).toBeCloseTo(75);
  });
});

describe('computeGrade: plain points', () => {
  it('is total earned over total possible', () => {
    const r = computeGrade([group(1, 0), group(2, 0)], [item(1, 10, 8), item(1, 10, 9), item(2, 50, 30)], { weighted: false });
    expect(r.current).toBeCloseTo((47 / 70) * 100);
  });
});

describe('computeGrade: drop rules', () => {
  it('drops the lowest percentage and reports it', () => {
    const items = [item(1, 10, 8), item(1, 10, 9), item(1, 10, 3)];
    const r = computeGrade([group(1, 100, { dropLowest: 1 })], items, { weighted: true });
    expect(r.current).toBeCloseTo(85);
    expect(r.groups[1].current.dropped).toEqual([items[2].id]);
  });

  it('judges by percent, not points (2/5 is lower than 9/10)', () => {
    const a = item(1, 10, 9);
    const b = item(1, 5, 2);
    const r = computeGrade([group(1, 100, { dropLowest: 1 })], [a, b], { weighted: true });
    expect(r.current).toBeCloseTo(90);
    expect(r.groups[1].current.dropped).toEqual([b.id]);
  });

  it('never drops items on the never-drop list', () => {
    const low = item(1, 10, 2);
    const high = item(1, 10, 9);
    const r = computeGrade([group(1, 100, { dropLowest: 1, neverDrop: [low.id] })], [low, high], { weighted: true });
    expect(r.groups[1].current.dropped).toEqual([high.id]);
  });

  it('supports dropping the highest', () => {
    const r = computeGrade([group(1, 100, { dropHighest: 1 })], [item(1, 10, 10), item(1, 10, 6), item(1, 10, 8)], { weighted: true });
    expect(r.current).toBeCloseTo(70);
  });

  it('always keeps at least one item', () => {
    const r = computeGrade([group(1, 100, { dropLowest: 5 })], [item(1, 10, 4), item(1, 10, 6)], { weighted: true });
    expect(r.groups[1].current.counted).toBe(1);
    expect(r.current).toBeCloseTo(60);
  });

  it('drops ungraded zeros first in the final grade', () => {
    const r = computeGrade([group(1, 100, { dropLowest: 1 })], [item(1, 10, 8), item(1, 10, 9), item(1, 10, null)], { weighted: true });
    expect(r.final).toBeCloseTo(85);
  });
});

describe('computeGrade: special items', () => {
  it('ignores excused and "omit from final grade" items', () => {
    const r = computeGrade([group(1, 100)], [item(1, 10, 10), item(1, 10, 0, { excused: true }), item(1, 100, 0, { omitted: true })], { weighted: true });
    expect(r.current).toBeCloseTo(100);
    expect(r.final).toBeCloseTo(100);
  });

  it('extra credit (a 0-point item with a score) only adds to earned', () => {
    expect(computeGrade([group(1, 100)], [item(1, 10, 10), item(1, 0, 2)], { weighted: true }).current).toBeCloseTo(120);
  });

  it('is null (not 0) when nothing is graded yet', () => {
    const r = computeGrade([group(1, 100)], [item(1, 10, null)], { weighted: true });
    expect(r.current).toBeNull();
    expect(r.final).toBeCloseTo(0);
  });
});

describe('what-if overrides', () => {
  it('replaces ungraded and graded scores without touching the real data', () => {
    const a = item(1, 10, 8);
    const b = item(1, 10, null);
    const gs = [group(1, 100)];
    expect(computeGrade(gs, [a, b], { weighted: true, overrides: { [b.id]: 10 } }).current).toBeCloseTo(90);
    expect(computeGrade(gs, [a, b], { weighted: true, overrides: { [a.id]: 2 } }).current).toBeCloseTo(20);
    expect(a.score).toBe(8);
  });
});

describe('gradeTrend', () => {
  it('replays the grade in the order work was graded', () => {
    const a = item(1, 10, 10, { gradedAt: '2026-01-01' });
    const b = item(1, 10, 5, { gradedAt: '2026-01-05' });
    const c = item(1, 10, 6, { gradedAt: '2026-01-03' });
    const t = gradeTrend([group(1, 100)], [a, b, c], true);
    expect(t.map((p) => p.item.id)).toEqual([a.id, c.id, b.id]);
    expect(t.map((p) => p.running)).toEqual([expect.closeTo(100), expect.closeTo(80), expect.closeTo(70)]);
  });
});

describe('neededAverage', () => {
  const gs = [group(1, 100)];
  const items = () => [item(1, 10, 8), item(1, 10, null)];

  it('solves for the average needed on the remaining work', () => {
    const r = neededAverage(gs, items(), { weighted: true }, 80);
    expect(r.status).toBe('reachable');
    expect(r.needed).toBeCloseTo(80, 1); // (8 + 8) / 20
  });

  it('says when a goal is already secured, out of reach, or nothing is left', () => {
    expect(neededAverage(gs, items(), { weighted: true }, 40).status).toBe('secured');
    const out = neededAverage(gs, items(), { weighted: true }, 95);
    expect(out.status).toBe('unreachable');
    expect(out.bestPossible).toBeCloseTo(90);
    expect(neededAverage(gs, [item(1, 10, 8)], { weighted: true }, 90).status).toBe('none');
  });

  it('treats what-if scores as assumptions, not remaining work', () => {
    const [a, b] = items();
    expect(neededAverage(gs, [a, b], { weighted: true, overrides: { [b.id]: 10 } }, 90).status).toBe('none');
  });
});

describe('toModel', () => {
  it('maps Canvas groups, rules and submissions, skipping not-graded assignments', () => {
    const canvas = [
      {
        id: 5, name: 'HW', position: 1, group_weight: 25, rules: { drop_lowest: 2, never_drop: [9] },
        assignments: [
          { id: 9, course_id: 1, name: 'A1', due_at: null, points_possible: 20, html_url: '', submission: { workflow_state: 'graded', score: 18, graded_at: '2026-02-01' } },
          { id: 10, course_id: 1, name: 'Survey', due_at: null, points_possible: 0, html_url: '', grading_type: 'not_graded' },
        ],
      },
    ] as AssignmentGroup[];
    const m = toModel(canvas);
    expect(m.groups[0]).toMatchObject({ weight: 25, dropLowest: 2, neverDrop: [9] });
    expect(m.items).toHaveLength(1);
    expect(m.items[0]).toMatchObject({ score: 18, points: 20, gradedAt: '2026-02-01' });
  });
});

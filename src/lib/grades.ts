// Grade maths, mirroring how Canvas computes a course total from assignment groups. Pure functions,
// no React: the page feeds in Canvas data (plus optional what-if scores) and gets numbers back.
//
//   current = graded work only (ungraded is ignored)      final = ungraded counts as 0
//   weighted course: Σ(weight × group %) / Σ(weights of groups that have counted work)
//   plain course:    Σ points earned / Σ points possible
// Drop rules (lowest / highest N, never-drop list) apply inside each group, per Canvas.

import type { AssignmentGroup } from '../api/types';

export interface GradeItem {
  id: number;
  groupId: number;
  name: string;
  dueAt: string | null;
  points: number;
  score: number | null; // null = not graded
  excused: boolean;
  omitted: boolean; // "omit from final grade"
  gradedAt: string | null;
}

export interface GradeGroup {
  id: number;
  name: string;
  weight: number; // percent
  position: number;
  dropLowest: number;
  dropHighest: number;
  neverDrop: number[];
}

export interface GroupStat {
  earned: number;
  possible: number;
  pct: number | null; // null when nothing counts yet
  counted: number;
  dropped: number[]; // item ids
}

export interface GradeResult {
  current: number | null; // percent
  final: number | null;
  groups: Record<number, { current: GroupStat; final: GroupStat }>;
}

export interface GradeOptions {
  weighted: boolean;
  /** What-if scores by item id, used in place of the real score. */
  overrides?: Record<number, number | null>;
  /** If set, only these items count as graded (used to replay the grade after each assignment). */
  onlyGraded?: Set<number>;
}

interface Entry {
  item: GradeItem;
  score: number;
}

export function toModel(groups: AssignmentGroup[]): { groups: GradeGroup[]; items: GradeItem[] } {
  const outGroups: GradeGroup[] = [];
  const items: GradeItem[] = [];
  for (const g of [...groups].sort((a, b) => a.position - b.position)) {
    outGroups.push({
      id: g.id,
      name: g.name,
      weight: g.group_weight ?? 0,
      position: g.position,
      dropLowest: g.rules?.drop_lowest ?? 0,
      dropHighest: g.rules?.drop_highest ?? 0,
      neverDrop: g.rules?.never_drop ?? [],
    });
    for (const a of g.assignments ?? []) {
      if (a.grading_type === 'not_graded') continue;
      const sub = a.submission;
      items.push({
        id: a.id,
        groupId: g.id,
        name: a.name,
        dueAt: a.due_at,
        points: a.points_possible ?? 0,
        score: sub?.score ?? null,
        excused: !!sub?.excused,
        omitted: !!a.omit_from_final_grade,
        gradedAt: sub?.graded_at ?? null,
      });
    }
  }
  return { groups: outGroups, items };
}

const pctOf = (e: Entry) => (e.item.points > 0 ? e.score / e.item.points : Infinity); // extra credit is never "lowest"

function applyDrops(entries: Entry[], g: GradeGroup): { kept: Entry[]; dropped: Entry[] } {
  if (entries.length <= 1 || (g.dropLowest <= 0 && g.dropHighest <= 0)) return { kept: entries, dropped: [] };
  const droppable = entries.filter((e) => !g.neverDrop.includes(e.item.id)).sort((a, b) => pctOf(a) - pctOf(b) || b.item.points - a.item.points);
  const low = droppable.slice(0, Math.min(g.dropLowest, entries.length - 1));
  const rest = droppable.filter((e) => !low.includes(e));
  const highCount = Math.max(0, Math.min(g.dropHighest, entries.length - low.length - 1, rest.length));
  const high = highCount ? rest.slice(rest.length - highCount) : [];
  const dropped = [...low, ...high];
  return { kept: entries.filter((e) => !dropped.includes(e)), dropped };
}

function stat(entries: Entry[], g: GradeGroup): GroupStat {
  const { kept, dropped } = applyDrops(entries, g);
  const earned = kept.reduce((n, e) => n + e.score, 0);
  const possible = kept.reduce((n, e) => n + e.item.points, 0);
  return { earned, possible, pct: possible > 0 ? (earned / possible) * 100 : null, counted: kept.length, dropped: dropped.map((e) => e.item.id) };
}

export function computeGrade(groups: GradeGroup[], items: GradeItem[], opts: GradeOptions): GradeResult {
  const out: GradeResult['groups'] = {};
  for (const g of groups) {
    const mine = items.filter((i) => i.groupId === g.id && !i.excused && !i.omitted);
    const graded: Entry[] = [];
    const everything: Entry[] = [];
    for (const item of mine) {
      const real = opts.onlyGraded && !opts.onlyGraded.has(item.id) ? null : item.score;
      const score = opts.overrides && item.id in opts.overrides ? opts.overrides[item.id] : real;
      if (score != null) graded.push({ item, score });
      if (item.points > 0 || score != null) everything.push({ item, score: score ?? 0 });
    }
    out[g.id] = { current: stat(graded, g), final: stat(everything, g) };
  }

  const weightedOk = opts.weighted && groups.some((g) => g.weight > 0);
  const total = (which: 'current' | 'final'): number | null => {
    if (weightedOk) {
      let w = 0;
      let sum = 0;
      for (const g of groups) {
        const s = out[g.id][which];
        if (s.pct == null || g.weight <= 0) continue;
        w += g.weight;
        sum += g.weight * s.pct;
      }
      return w > 0 ? sum / w : null;
    }
    let earned = 0;
    let possible = 0;
    for (const g of groups) {
      earned += out[g.id][which].earned;
      possible += out[g.id][which].possible;
    }
    return possible > 0 ? (earned / possible) * 100 : null;
  };
  return { current: total('current'), final: total('final'), groups: out };
}

export interface TrendPoint {
  item: GradeItem;
  running: number; // current grade right after this assignment was graded
}

/** The current grade replayed assignment by assignment, in the order they were graded. */
export function gradeTrend(groups: GradeGroup[], items: GradeItem[], weighted: boolean): TrendPoint[] {
  const when = (i: GradeItem) => i.gradedAt ?? i.dueAt ?? '';
  const graded = items.filter((i) => i.score != null && !i.excused && !i.omitted).sort((a, b) => when(a).localeCompare(when(b)) || a.id - b.id);
  const seen = new Set<number>();
  const points: TrendPoint[] = [];
  for (const item of graded) {
    seen.add(item.id);
    const { current } = computeGrade(groups, items, { weighted, onlyGraded: new Set(seen) });
    if (current != null) points.push({ item, running: current });
  }
  return points;
}

export interface Needed {
  status: 'none' | 'secured' | 'reachable' | 'unreachable';
  remaining: number; // ungraded assignments still to come
  needed: number | null; // average percent required across them
  bestPossible: number | null; // final grade if every remaining one is perfect
}

/** What average score on the remaining (ungraded) work lands the final grade on `target`? */
export function neededAverage(groups: GradeGroup[], items: GradeItem[], opts: GradeOptions, target: number): Needed {
  const overrides = opts.overrides ?? {};
  const remaining = items.filter((i) => i.score == null && !i.excused && !i.omitted && i.points > 0 && !(i.id in overrides));
  const finalAt = (p: number) => {
    const assume = Object.fromEntries(remaining.map((i) => [i.id, (i.points * p) / 100]));
    return computeGrade(groups, items, { ...opts, overrides: { ...overrides, ...assume } }).final;
  };
  if (remaining.length === 0) return { status: 'none', remaining: 0, needed: null, bestPossible: null };
  const floor = finalAt(0);
  const best = finalAt(100);
  if (floor != null && floor >= target) return { status: 'secured', remaining: remaining.length, needed: 0, bestPossible: best };
  if (best == null || best < target) return { status: 'unreachable', remaining: remaining.length, needed: null, bestPossible: best };
  let lo = 0;
  let hi = 100;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if ((finalAt(mid) ?? 0) >= target) hi = mid;
    else lo = mid;
  }
  return { status: 'reachable', remaining: remaining.length, needed: hi, bestPossible: best };
}

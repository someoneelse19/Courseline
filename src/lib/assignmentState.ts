import type { Assignment } from '../api/types';
import { isPast } from './format';

/** Done = turned in, graded or excused. Everything else (including missing/past due) is still pending. */
export function isDone(a: Assignment): boolean {
  const s = a.submission;
  if (!s) return false;
  return s.excused === true || s.workflow_state === 'graded' || s.workflow_state === 'submitted' || s.workflow_state === 'pending_review';
}

export type Tone = 'missing' | 'todo' | 'done';

/** What an assignment looks like on the calendar: red = missing, blue = still to do, green = handed in. */
export function assignmentTone(a: Assignment): Tone {
  if (isDone(a)) return 'done';
  return a.submission?.missing ? 'missing' : 'todo';
}

export const TONE_CLASSES: Record<Tone, string> = {
  missing: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  todo: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  done: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
};

/** Finished work with no due date: it is placed (and shown) by when it was handed in. */
export const isSubmittedUndated = (a: Assignment): boolean => !a.due_at && isDone(a) && !!a.submission?.submitted_at;

/** Finished work whose due date has passed, or that never had one, fades back so what still needs attention stands out. */
export const isFaded = (a: Assignment): boolean => isDone(a) && (isPast(a.due_at) || !a.due_at);

/** The date an assignment is placed by: its due date; handed in with none, the day it was handed in; else the day it was posted (or becomes available). */
export const assignmentDate = (a: Assignment): string | null =>
  a.due_at ?? (isSubmittedUndated(a) ? a.submission!.submitted_at! : null) ?? a.created_at ?? a.unlock_at ?? null;

/**
 * Most relevant first: what is coming up, soonest first, then what already passed, most recent
 * first. Undated assignments go last. Applies the same way to pending and finished work.
 */
export function sortAssignments(list: Assignment[], now = Date.now()): Assignment[] {
  const time = (a: Assignment) => {
    const d = assignmentDate(a);
    return d ? new Date(d).getTime() : null;
  };
  const rank = (a: Assignment) => {
    const x = time(a);
    return x === null ? 2 : x >= now ? 0 : 1;
  };
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const ta = time(a) ?? 0;
    const tb = time(b) ?? 0;
    return (ra === 0 ? ta - tb : tb - ta) || a.name.localeCompare(b.name);
  });
}

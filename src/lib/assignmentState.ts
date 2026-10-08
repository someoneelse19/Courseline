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

/** Finished work whose due date has passed fades back, so what still needs attention stands out. */
export const isFaded = (a: Assignment): boolean => isDone(a) && isPast(a.due_at);

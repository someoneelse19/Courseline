// Feedback the student has not looked at yet: a grade, or a comment from someone else.
//
// With a token, Canvas decides: its read state of each submission (api getSubmissionReadStates) says what is unread,
// newFeedbackFromCanvas says which grade and comments that is, and opening the assignment marks it read in Canvas
// (hooks/useReadState.ts). This file's own record is the fallback, for the extension (which cannot read Canvas's read
// state of submissions or change it) and for a course whose read state could not be loaded: feedback newer than the last
// time the assignment was opened here, kept in this browser (localStorage `courseline.feedbackSeen`). Per course, since
// when this is kept (feedback from before then was already there); per assignment, the time of the newest feedback seen.
import { useSyncExternalStore } from 'react';
import type { Submission } from '../api/types';

export interface FeedbackStore {
  /** Per course id: when its record started (ms). */
  since: Record<string, number>;
  /** Per `<courseId>:<assignmentId>`: the newest feedback seen (ms). */
  seen: Record<string, number>;
}

const KEY = 'courseline.feedbackSeen';
const EMPTY: FeedbackStore = { since: {}, seen: {} };

let cache: FeedbackStore | null = null;
const listeners = new Set<() => void>();

export function readFeedbackStore(): FeedbackStore {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<FeedbackStore> | null;
    const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {});
    cache = { since: obj(parsed?.since), seen: obj(parsed?.seen) };
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: FeedbackStore) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: still counts for this visit */
  }
  listeners.forEach((notify) => notify());
}

const keyOf = (courseId: number, assignmentId: number) => `${courseId}:${assignmentId}`;

/** Starts the record of each course that has none yet: feedback from before now counts as already seen. */
export function startFeedbackRecord(courseIds: number[], now = Date.now()): void {
  const store = readFeedbackStore();
  const missing = [...new Set(courseIds)].filter((id) => store.since[id] == null);
  if (!missing.length) return;
  write({ ...store, since: { ...store.since, ...Object.fromEntries(missing.map((id) => [id, now])) } });
}

/** Records that the feedback up to `at` (ms) on this assignment has been seen. */
export function markFeedbackSeen(courseId: number, assignmentId: number, at: number, now = Date.now()): void {
  const store = readFeedbackStore();
  const key = keyOf(courseId, assignmentId);
  if ((store.seen[key] ?? -Infinity) >= at && store.since[courseId] != null) return;
  write({
    since: store.since[courseId] != null ? store.since : { ...store.since, [courseId]: now },
    seen: { ...store.seen, [key]: Math.max(store.seen[key] ?? -Infinity, at) },
  });
}

/** Drop the in-memory copy, so the next read is from storage (tests). */
export function resetFeedbackSeen(): void {
  cache = null;
  listeners.forEach((notify) => notify());
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** When the grade was given, if the submission has one (NaN when it does not, or Canvas sent no time). */
export function gradedAt(sub: Submission | undefined): number {
  if (!sub || (sub.score == null && !sub.grade)) return NaN;
  return time(sub.graded_at);
}

/** Comments on the submission from anyone but `me` (the teacher's, a classmate's in peer review). */
export const othersComments = (sub: Submission | undefined, me: number | undefined) =>
  (sub?.submission_comments ?? []).filter((c) => me == null || c.author_id !== me);

/** The newest feedback on a submission (ms): its grade or a comment from someone else. NaN when there is none. */
export function latestFeedback(sub: Submission | undefined, me: number | undefined): number {
  const times = [gradedAt(sub), ...othersComments(sub, me).map((c) => time(c.created_at))].filter((n) => !Number.isNaN(n));
  return times.length ? Math.max(...times) : NaN;
}

/**
 * Is feedback given at `at` (ms) unseen? Only once the course's record has started, and only if it came after that
 * start and after the newest feedback seen on this assignment.
 */
export function isUnseenFeedback(courseId: number, assignmentId: number, at: number, store: FeedbackStore): boolean {
  const since = store.since[courseId];
  if (Number.isNaN(at) || since == null || at < since) return false;
  const seen = store.seen[keyOf(courseId, assignmentId)];
  return seen == null || at > seen;
}

/** Canvas's read state of one submission (from getSubmissionReadStates). */
export interface CanvasFeedbackState {
  unread: boolean;
  unreadComments: number;
}

/**
 * Which feedback on a submission is new by Canvas's read state. Canvas says how many comments are unread, not which:
 * they are the newest ones from others. The grade counts as new when the submission is unread and the grade is not
 * older than those comments (a submission unread only for a new comment does not make an old grade new).
 */
export function newFeedbackFromCanvas(sub: Submission | undefined, me: number | undefined, state: CanvasFeedbackState): { grade: boolean; commentIds: Set<number> } {
  if (!state.unread) return { grade: false, commentIds: new Set() };
  const others = [...othersComments(sub, me)].sort((a, b) => time(a.created_at) - time(b.created_at));
  const fresh = state.unreadComments > 0 ? others.slice(-state.unreadComments) : [];
  const graded = sub != null && (sub.score != null || !!sub.grade);
  const oldestFresh = fresh.length ? time(fresh[0].created_at) : NaN;
  const at = gradedAt(sub);
  const grade = graded && (!fresh.length || Number.isNaN(at) || Number.isNaN(oldestFresh) || at >= oldestFresh);
  return { grade, commentIds: new Set(fresh.map((c) => c.id)) };
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

/** The whole record, kept current. */
export function useFeedbackStore(): FeedbackStore {
  return useSyncExternalStore(subscribe, readFeedbackStore);
}

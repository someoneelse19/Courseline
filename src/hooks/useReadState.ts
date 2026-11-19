// Unread markers, with Canvas as the source of truth. With a token the app can read Canvas's read state and change
// it: an announcement is new when Canvas has it unread, feedback is new when Canvas has the submission unread, and
// looking at either here marks it read in Canvas too (so Canvas's own dots go as well). The extension can do neither
// (it only reads what Canvas pages fetched, and Canvas's read state of submissions is not among it): there the app's
// own records decide (lib/seen.ts, lib/feedback.ts), as they do for anything Canvas has no read state for (assignments).
// Between marking something read and the next fetch of Canvas's lists, lib/canvasRead.ts covers the gap.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Assignment, DiscussionTopic, Submission } from '../api/types';
import type { SubmissionReadState } from '../api/canvas';
import { useApi, useAuth } from '../context/AuthContext';
import { useQueryStore } from '../context/DataContext';
import { isReadHere, markReadHere, runLimited, submissionKey, topicKey, useReadHere } from '../lib/canvasRead';
import {
  gradedAt,
  isUnseenFeedback,
  latestFeedback,
  markFeedbackSeen,
  newFeedbackFromCanvas,
  othersComments,
  readFeedbackStore,
  useFeedbackStore,
  type CanvasFeedbackState,
  type FeedbackStore,
} from '../lib/feedback';
import { isNew, markSeen, useSeenAll } from '../lib/seen';
import { useQuery, type QueryResult } from './useQuery';

/** Canvas's read state decides: signed in with a token, so the app can read it and mark things read. */
export function useCanvasDecides(): boolean {
  return useAuth().source === 'token';
}

// --- Announcements ---------------------------------------------------------------------------------------------------

/** `isNewPost(courseId, post)`: is this announcement new to the student? Kept current. */
export function useIsNewPost(): (courseId: number, post: DiscussionTopic) => boolean {
  const canvasDecides = useCanvasDecides();
  const seenOf = useSeenAll();
  const readHere = useReadHere();
  return useCallback(
    (courseId: number, post: DiscussionTopic) => {
      if (canvasDecides && readHere.has(topicKey(courseId, post.id))) return false;
      return isNew({ ...post, date: post.posted_at }, seenOf(courseId, 'announcements'), canvasDecides);
    },
    [canvasDecides, seenOf, readHere],
  );
}

/**
 * `markPostsRead(courseId, posts)`: the student has seen these announcements. Recorded here, and with a token the ones
 * Canvas has unread are marked read in Canvas (a few at a time; one that fails stays read here for this visit).
 */
export function useMarkPostsRead(): (courseId: number, posts: DiscussionTopic[]) => void {
  const api = useApi();
  const canvasDecides = useCanvasDecides();
  return useCallback(
    (courseId: number, posts: DiscussionTopic[]) => {
      markSeen(courseId, 'announcements', posts.map((p) => p.id));
      if (!canvasDecides) return;
      const unread = posts.filter((p) => p.read_state === 'unread' && !isReadHere(topicKey(courseId, p.id)));
      if (!unread.length) return;
      markReadHere(unread.map((p) => topicKey(courseId, p.id)));
      void runLimited(unread.map((p) => () => api.markTopicRead(courseId, p.id)));
    },
    [api, canvasDecides],
  );
}

// --- Feedback --------------------------------------------------------------------------------------------------------

/** Per course, per assignment: Canvas's read state of the student's submission. */
export type FeedbackStates = ReadonlyMap<number, ReadonlyMap<number, CanvasFeedbackState>>;

/**
 * Canvas's read state of the student's submissions in these courses (with a token; empty with the extension). A course
 * whose state could not be loaded is left out, and its feedback falls back to the record kept here. Each course is its
 * own cache entry (`submissionReadStates:<id>`), shared by every screen that asks. Undefined while loading.
 */
export function useSubmissionReadStates(courseIds: number[]): FeedbackStates | undefined {
  const api = useApi();
  const store = useQueryStore();
  const canvasDecides = useCanvasDecides();
  const ids = useMemo(() => [...new Set(courseIds)].sort((a, b) => a - b), [courseIds]);
  // Its own key prefix: with one course, `submissionReadStates:<id>` would be the per-course entry it reads below, and the
  // query would wait on itself (or take that entry's list for its own).
  const { data } = useQuery(`submissionReadStatesOf:${canvasDecides ? ids.join(',') : 'off'}`, async () => {
    if (!canvasDecides) return [] as [number, SubmissionReadState[] | null][];
    return Promise.all(
      ids.map(async (id): Promise<[number, SubmissionReadState[] | null]> => {
        try {
          return [id, await store.ensure(`submissionReadStates:${id}`, () => api.getSubmissionReadStates(id))];
        } catch (err) {
          console.warn(`[read state] Canvas's read state of course ${id}'s submissions could not be loaded; using the record kept here`, err);
          return [id, null];
        }
      }),
    );
  });
  return useMemo(() => {
    if (!data) return undefined;
    const out = new Map<number, Map<number, CanvasFeedbackState>>();
    for (const [courseId, list] of data) if (list) out.set(courseId, new Map(list.map((s) => [s.assignmentId, { unread: s.unread, unreadComments: s.unreadComments }])));
    return out;
  }, [data]);
}

/** Canvas's state for one assignment's submission, with what was marked read here applied; undefined when Canvas's is not known. */
export function canvasFeedbackState(states: FeedbackStates | undefined, readHere: ReadonlySet<string>, courseId: number, assignmentId: number): CanvasFeedbackState | undefined {
  const course = states?.get(courseId);
  if (!course) return undefined;
  if (readHere.has(submissionKey(courseId, assignmentId))) return { unread: false, unreadComments: 0 };
  // A course Canvas answered for but with no row for this assignment: nothing there is unread.
  return course.get(assignmentId) ?? { unread: false, unreadComments: 0 };
}

/**
 * `unread(a)`: does this assignment (from a list, with its submission) have feedback the student has not looked at?
 * Canvas's read state where it is known, else the record kept here. Kept current.
 */
export function useUnreadFeedback(me: number | undefined, courseIds: number[]): (a: Assignment) => boolean {
  const states = useSubmissionReadStates(courseIds);
  const readHere = useReadHere();
  const local = useFeedbackStore();
  return useCallback(
    (a: Assignment) => {
      const canvas = canvasFeedbackState(states, readHere, a.course_id, a.id);
      if (canvas) return canvas.unread;
      return isUnseenFeedback(a.course_id, a.id, latestFeedback(a.submission, me), local);
    },
    [states, readHere, local, me],
  );
}

/**
 * `markFeedbackRead(courseId, assignmentId)`: the student opened the assignment. With a token, marks the submission
 * read in Canvas (grade, comments and rubric). The record kept here is updated by the caller either way.
 */
export function useMarkFeedbackRead(): (courseId: number, assignmentId: number) => void {
  const api = useApi();
  const { user } = useAuth();
  const canvasDecides = useCanvasDecides();
  return useCallback(
    (courseId: number, assignmentId: number) => {
      if (!canvasDecides || !user || isReadHere(submissionKey(courseId, assignmentId))) return;
      markReadHere([submissionKey(courseId, assignmentId)]);
      api.markSubmissionRead(courseId, assignmentId, user.id).catch(() => {});
    },
    [api, user, canvasDecides],
  );
}

/** Which feedback on an opened assignment is new (see useOpenFeedback). */
export interface OpenedFeedback {
  /** What to show: the full submission, or the one the assignment carries until it loads. */
  sub: Submission | undefined;
  newGrade: boolean;
  newCommentIds: ReadonlySet<number>;
  /** Anything new, a rubric score alone included (Canvas can have a submission unread for that, with no marker of its own). */
  hasNew: boolean;
}

/**
 * The student opened this assignment's feedback (its page, or its row on the Grades screen). What was unread when it
 * opened is kept for the visit, so the markers stay while it is read; then it is all marked read: in Canvas too with a
 * token (Canvas decides), in the record kept here either way. Waits for the full submission, which carries the
 * comments, and for Canvas's read state. `fallback` is the submission the assignment carries.
 */
export function useOpenFeedback(courseId: number, assignmentId: number, submission: QueryResult<Submission>, fallback: Submission | undefined): OpenedFeedback {
  const { user } = useAuth();
  const canvasDecides = useCanvasDecides();
  const readStates = useSubmissionReadStates(useMemo(() => [courseId], [courseId]));
  const readHere = useReadHere();
  const markFeedbackRead = useMarkFeedbackRead();
  const [before, setBefore] = useState<{ key: string; store: FeedbackStore; canvas?: CanvasFeedbackState } | null>(null);
  const visitKey = `${courseId}:${assignmentId}`;
  const loadedSub = submission.loading ? undefined : (submission.data ?? fallback);
  useEffect(() => {
    if (!loadedSub || (canvasDecides && readStates === undefined)) return;
    const canvas = canvasFeedbackState(readStates, readHere, courseId, assignmentId);
    setBefore((b) => (b?.key === visitKey ? b : { key: visitKey, store: readFeedbackStore(), canvas }));
    const latest = latestFeedback(loadedSub, user?.id);
    if (!Number.isNaN(latest)) markFeedbackSeen(courseId, assignmentId, latest);
    if (canvas?.unread) markFeedbackRead(courseId, assignmentId);
  }, [loadedSub, visitKey, courseId, assignmentId, user?.id, canvasDecides, readStates, readHere, markFeedbackRead]);

  // The richer standalone submission when there is one.
  const sub = submission.data ?? fallback;
  const visit = before?.key === visitKey ? before : null;
  const isNewAt = (at: number) => visit != null && isUnseenFeedback(courseId, assignmentId, at, visit.store);
  const fromCanvas = visit?.canvas ? newFeedbackFromCanvas(sub, user?.id, visit.canvas) : null;
  const newGrade = fromCanvas ? fromCanvas.grade : isNewAt(gradedAt(sub));
  const newCommentIds = fromCanvas ? fromCanvas.commentIds : new Set(othersComments(sub, user?.id).filter((c) => isNewAt(Date.parse(c.created_at))).map((c) => c.id));
  return { sub, newGrade, newCommentIds, hasNew: newGrade || newCommentIds.size > 0 || !!visit?.canvas?.unread };
}

/** What is new on an assignment, for a list row (see useNewFeedbackKind). */
export interface NewFeedbackKind {
  /** The grade (or a rubric score) is new. Undefined: Canvas cannot tell without the comments (see resolveNewGrade). */
  grade: boolean | undefined;
  /** Comments from someone else are new. */
  comments: boolean;
  /** Canvas's state behind it; undefined when the record kept here decided. */
  canvas?: CanvasFeedbackState;
}

/**
 * `kind(a)`: what is new on this assignment (from a list, with its submission but not its comments), or null when
 * nothing is. With Canvas's read state: comments when Canvas counts unread ones; the grade when the submission is unread
 * and graded with no unread comments (a rubric score alone counts as the grade). Graded with unread comments too, only the
 * comments' times say whether the grade is new as well: `grade` is undefined, for resolveNewGrade. With the record kept
 * here (the extension), only grades: a list's submissions carry no comments. Kept current.
 */
export function useNewFeedbackKind(me: number | undefined, courseIds: number[]): (a: Assignment) => NewFeedbackKind | null {
  const states = useSubmissionReadStates(courseIds);
  const readHere = useReadHere();
  const local = useFeedbackStore();
  return useCallback(
    (a: Assignment) => {
      const canvas = canvasFeedbackState(states, readHere, a.course_id, a.id);
      if (canvas) {
        if (!canvas.unread) return null;
        const graded = a.submission != null && (a.submission.score != null || !!a.submission.grade);
        const comments = canvas.unreadComments > 0;
        return { grade: !graded ? false : comments ? undefined : true, comments, canvas };
      }
      return isUnseenFeedback(a.course_id, a.id, latestFeedback(a.submission, me), local) ? { grade: true, comments: false } : null;
    },
    [states, readHere, local, me],
  );
}

/** For a kind with `grade` undefined: is the grade new too? Decided from the full submission (with its comments). */
export function resolveNewGrade(full: Submission | undefined, me: number | undefined, canvas: CanvasFeedbackState): boolean | undefined {
  return full ? newFeedbackFromCanvas(full, me, canvas).grade : undefined;
}

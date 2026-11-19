// One-liner hooks per resource. Adding a feature = adding a function here
// (plus the endpoint in api/canvas.ts). Keys must include every fetcher input.
import { useCallback, useEffect, useMemo } from 'react';
import { useApi, useAuth } from '../context/AuthContext';
import { pinnedIds } from '../extension/extensionApi';
import { orderCourses, useCourseFilter } from '../context/CourseFilterContext';
import { useQueryStore } from '../context/DataContext';
import { useCourseStyles } from '../context/CourseStyleContext';
import { DEFAULT_COURSE_ICON, type CourseIconKey } from '../lib/courseIcons';
import { buildCourseColors, NEUTRAL_COURSE_COLOR } from '../lib/courseColor';
import type { MailScope } from '../api/types';
import { isNew, markSeen, useSeen, useSeenAll } from '../lib/seen';
import { useIsNewPost, useUnreadFeedback } from './useReadState';
import { startFeedbackRecord } from '../lib/feedback';
import { useCourseKinds, type CommunityNews } from '../lib/communities';
import { useQuery } from './useQuery';

export function useCourses() {
  const api = useApi();
  return useQuery('courses', api.getCourses);
}

/** Courses limited to the user's selection, in the user's order (Settings page). Use this in views; useCourses() is the full list. */
export function useVisibleCourses() {
  const result = useCourses();
  const { isVisible, selected, order } = useCourseFilter();
  const { source, snapshot } = useAuth();
  // With the extension and no choice made in Settings yet, show the courses that were captured (the pinned ones),
  // not every course Canvas lists, most of which would be empty.
  const captured = useMemo(
    () => (source === 'extension' && snapshot && selected === null ? pinnedIds(snapshot) : null),
    [source, snapshot, selected],
  );
  const data = useMemo(
    () => (result.data ? orderCourses(result.data.filter((c) => isVisible(c.id) && (!captured || captured.has(c.id))), order) : undefined),
    [result.data, isVisible, captured, order],
  );
  return { ...result, data };
}

/**
 * The school's communities (library, student life, the degree-wide space…): what the student is enrolled in besides
 * their course list, minus what looks like a class (lib/communities.ts looksLikeClass, or the student's correction).
 * `otherClasses`: those classes, say next semester's, not in the course list yet. Both sorted by name.
 */
export function useCommunities() {
  const all = useCourses();
  const { data: visible } = useVisibleCourses();
  const { isClass } = useCourseKinds();
  const split = useMemo(() => {
    if (!all.data || !visible) return undefined;
    const mine = new Set(visible.map((c) => c.id));
    const rest = all.data.filter((c) => !mine.has(c.id)).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    return { communities: rest.filter((c) => !isClass(c)), otherClasses: rest.filter((c) => isClass(c)) };
  }, [all.data, visible, isClass]);
  return { ...all, data: split?.communities, otherClasses: split?.otherClasses };
}

/** Posts older than this are not "new" the first time a community is seen, even if Canvas still has them unread. */
const COMMUNITY_BACKLOG_MS = 14 * 24 * 3600_000;

/**
 * Every community's announcements, for the feed and the sidebar count. Each goes through its own entry (the one
 * useAnnouncements reads), so the community's own page shares it. One that cannot be loaded (not synced yet, or hidden
 * by the school) comes back with `posts: null` instead of failing the rest.
 *
 * The first time a community's posts load, what is there becomes the starting point of the record kept here:
 * communities pile up posts nobody opens in Canvas, so for the extension only Canvas-unread ones from the last two weeks
 * stay new. With a token Canvas decides (hooks/useReadState.ts): every post it has unread is new, until the feed is
 * opened, which marks them read in Canvas.
 */
export function useCommunityNews(courseIds: number[]) {
  const api = useApi();
  const store = useQueryStore();
  const result = useQuery(`communityNews:${courseIds.join(',')}`, () =>
    Promise.all(
      courseIds.map(async (courseId): Promise<CommunityNews> => {
        try {
          return { courseId, posts: await store.ensure(`announcements:${courseId}`, () => api.getAnnouncements(courseId)) };
        } catch {
          return { courseId, posts: null };
        }
      }),
    ),
  );
  const seenOf = useSeenAll();
  useEffect(() => {
    const cutoff = Date.now() - COMMUNITY_BACKLOG_MS;
    for (const { courseId, posts } of result.data ?? []) {
      if (!posts || seenOf(courseId, 'announcements')) continue;
      const old = posts.filter((p) => p.read_state !== 'unread' || !(Date.parse(p.posted_at ?? '') >= cutoff));
      markSeen(courseId, 'announcements', old.map((p) => p.id));
    }
  }, [result.data, seenOf]);
  return result;
}

/** `colorOf(courseId)`: that course's unique color (see lib/courseColor.ts) unless the user picked one in Settings. Based on the full course list, so Settings filters don't shift colors. */
export function useCourseColors(): (courseId: number) => string {
  const { data } = useCourses();
  const { styles } = useCourseStyles();
  const colors = useMemo(() => buildCourseColors((data ?? []).map((c) => c.id)), [data]);
  return useCallback((courseId) => styles[courseId]?.color ?? colors.get(courseId) ?? NEUTRAL_COURSE_COLOR, [styles, colors]);
}

/** `iconOf(courseId)`: the icon the user picked for that course (a book by default). */
export function useCourseIcons(): (courseId: number) => CourseIconKey {
  const { styles } = useCourseStyles();
  return useCallback((courseId) => styles[courseId]?.icon ?? DEFAULT_COURSE_ICON, [styles]);
}

export function useCourse(courseId: number) {
  const api = useApi();
  return useQuery(`course:${courseId}`, () => api.getCourse(courseId));
}

export function useAssignments(courseId: number) {
  const api = useApi();
  return useQuery(`assignments:${courseId}`, () => api.getAssignments(courseId));
}

/**
 * Assignments across several courses at once (one request per course, in parallel). Each course goes through its own
 * entry, the one useAssignments reads, so the course screens and the cross-course ones share one copy.
 */
export function useAllAssignments(courseIds: number[]) {
  const api = useApi();
  const store = useQueryStore();
  return useQuery(`assignments:all:${courseIds.join(',')}`, async () =>
    (await Promise.all(courseIds.map((id) => store.ensure(`assignments:${id}`, () => api.getAssignments(id))))).flat(),
  );
}

export function useAssignment(courseId: number, assignmentId: number) {
  const api = useApi();
  return useQuery(`assignment:${courseId}:${assignmentId}`, () => api.getAssignment(courseId, assignmentId));
}

export function useMySubmission(courseId: number, assignmentId: number) {
  const api = useApi();
  return useQuery(`submission:${courseId}:${assignmentId}`, () => api.getMySubmission(courseId, assignmentId));
}

export function useModules(courseId: number) {
  const api = useApi();
  return useQuery(`modules:${courseId}`, () => api.getModules(courseId));
}

export function useModuleItems(courseId: number, moduleId: number) {
  const api = useApi();
  return useQuery(`moduleItems:${courseId}:${moduleId}`, () => api.getModuleItems(courseId, moduleId));
}

export function usePage(courseId: number, pageUrl: string) {
  const api = useApi();
  return useQuery(`page:${courseId}:${pageUrl}`, () => api.getPage(courseId, pageUrl));
}

export function usePages(courseId: number) {
  const api = useApi();
  const store = useQueryStore();
  return useQuery(`pages:${courseId}`, async () => {
    // Discovery reads the modules list: share useModules' copy (same key and fetcher) instead of fetching it twice.
    const pages = await api.getPages(courseId, () => store.ensure(`modules:${courseId}`, () => api.getModules(courseId)));
    // These carry their bodies, so module rows that look a page up (usePage) don't fetch it again.
    for (const p of pages) if (p.url) store.prime(`page:${courseId}:${p.url}`, p);
    return pages;
  });
}

export function useCourseFiles(courseId: number) {
  const api = useApi();
  return useQuery(`files:${courseId}`, () => api.getCourseFiles(courseId));
}

export function useUpcoming() {
  const api = useApi();
  return useQuery('upcoming', api.getUpcoming);
}

export function useAnnouncements(courseId: number) {
  const api = useApi();
  return useQuery(`announcements:${courseId}`, () => api.getAnnouncements(courseId));
}

export function useDiscussions(courseId: number) {
  const api = useApi();
  return useQuery(`discussions:${courseId}`, () => api.getDiscussions(courseId));
}

/**
 * How many announcements, assignments and pieces of feedback in a course are new to the student, for the dots on the
 * course tabs.
 * Announcements: Canvas's read state with a token (hooks/useReadState.ts), else lib/seen.ts. Assignments: lib/seen.ts
 * (Canvas has no read state for them). The first time a course's list loads, what is there becomes the starting point
 * of the record kept here (an announcement Canvas says is unread stays new). Feedback: see useUnreadFeedback.
 */
export function useNewInCourse(courseId: number) {
  const announcements = useAnnouncements(courseId);
  const assignments = useAssignments(courseId);
  const seenAnnouncements = useSeen(courseId, 'announcements');
  const seenAssignments = useSeen(courseId, 'assignments');
  const isNewPost = useIsNewPost();
  const courseIds = useMemo(() => [courseId], [courseId]);
  const unreadFeedback = useUnreadFeedback(useAuth().user?.id, courseIds);
  useEffect(() => startFeedbackRecord(courseIds), [courseIds]);
  useEffect(() => {
    if (announcements.data && !seenAnnouncements) markSeen(courseId, 'announcements', announcements.data.filter((a) => a.read_state !== 'unread').map((a) => a.id));
  }, [courseId, announcements.data, seenAnnouncements]);
  useEffect(() => {
    if (assignments.data && !seenAssignments) markSeen(courseId, 'assignments', assignments.data.map((a) => a.id));
  }, [courseId, assignments.data, seenAssignments]);
  return {
    announcements: (announcements.data ?? []).filter((a) => isNewPost(courseId, a)).length,
    assignments: (assignments.data ?? []).filter((a) => isNew({ id: a.id, date: a.created_at }, seenAssignments)).length,
    /** Assignments with feedback not looked at yet (shown on the Grades tab). */
    feedback: (assignments.data ?? []).filter(unreadFeedback).length,
  };
}

export function useAssignmentGroups(courseId: number) {
  const api = useApi();
  return useQuery(`assignmentGroups:${courseId}`, () => api.getAssignmentGroups(courseId));
}

// --- Inbox -------------------------------------------------------------------------------------------------------

export function useConversations(scope: MailScope) {
  const api = useApi();
  return useQuery(`conversations:${scope}`, () => api.getConversations(scope));
}

export function useConversation(id: number) {
  const api = useApi();
  return useQuery(`conversation:${id}`, () => api.getConversation(id));
}

export function useUnreadCount() {
  const api = useApi();
  return useQuery('conversations:unread', api.getUnreadCount);
}

/** Everyone in a course, for its People tab (teachers first). */
export function useCoursePeople(courseId: number, everyone = false) {
  const api = useApi();
  return useQuery(`people:${courseId}${everyone ? ':everyone' : ''}`, () => api.getCoursePeople(courseId, everyone));
}

/** The course's Canvas menu (token mode; in extension mode it fails, and screens show what they did before). */
export function useCourseTabs(courseId: number) {
  const api = useApi();
  return useQuery(`tabs:${courseId}`, () => api.getCourseTabs(courseId));
}

/** A course's teachers and TAs (token mode; New message). */
export function useCourseStaff(courseId: number | null, enabled = true) {
  const api = useApi();
  const on = enabled && courseId !== null;
  return useQuery(on ? `staff:${courseId}` : 'staff:none', async () => (on ? api.getCourseStaff(courseId) : []));
}

/** Some of a course's students: a name search, given ids, or the first by name (token mode; New message). */
export function useClassmates(courseId: number | null, q: { term?: string; userIds?: number[] }, enabled = true) {
  const api = useApi();
  const key = q.userIds ? `ids=${q.userIds.join(',')}` : `term=${(q.term ?? '').trim().toLowerCase()}`;
  const on = enabled && courseId !== null;
  return useQuery(on ? `classmates:${courseId}:${key}` : 'classmates:none', async () => (on ? api.findClassmates(courseId, q) : []));
}

/** Teachers, TAs and classmates of a course: who the student can message about it. */
export function useCourseRecipients(courseId: number | null) {
  const api = useApi();
  return useQuery(`recipients:${courseId ?? 'none'}`, async () => (courseId ? api.getCourseRecipients(courseId) : []));
}

// One-liner hooks per resource. Adding a feature = adding a function here
// (plus the endpoint in api/canvas.ts). Keys must include every fetcher input.
import { useCallback, useMemo } from 'react';
import { useApi, useAuth } from '../context/AuthContext';
import { pinnedIds } from '../extension/extensionApi';
import { useCourseFilter } from '../context/CourseFilterContext';
import { useQueryStore } from '../context/DataContext';
import { useCourseStyles } from '../context/CourseStyleContext';
import { DEFAULT_COURSE_ICON, type CourseIconKey } from '../lib/courseIcons';
import { buildCourseColors, NEUTRAL_COURSE_COLOR } from '../lib/courseColor';
import type { MailScope } from '../api/types';
import { useQuery } from './useQuery';

export function useCourses() {
  const api = useApi();
  return useQuery('courses', api.getCourses);
}

/** Courses limited to the user's selection (Settings page). Use this in views; useCourses() is the full list. */
export function useVisibleCourses() {
  const result = useCourses();
  const { isVisible, selected } = useCourseFilter();
  const { source, snapshot } = useAuth();
  // With the extension and no choice made in Settings yet, show the courses that were captured (the pinned ones),
  // not every course Canvas lists, most of which would be empty.
  const captured = useMemo(
    () => (source === 'extension' && snapshot && selected === null ? pinnedIds(snapshot) : null),
    [source, snapshot, selected],
  );
  const data = useMemo(
    () => result.data?.filter((c) => isVisible(c.id) && (!captured || captured.has(c.id))),
    [result.data, isVisible, captured],
  );
  return { ...result, data };
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

/** Teachers, TAs and classmates of a course: who the student can message about it. */
export function useCourseRecipients(courseId: number | null) {
  const api = useApi();
  return useQuery(`recipients:${courseId ?? 'none'}`, async () => (courseId ? api.getCourseRecipients(courseId) : []));
}

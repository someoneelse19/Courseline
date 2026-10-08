// One-liner hooks per resource. Adding a feature = adding a function here
// (plus the endpoint in api/canvas.ts). Keys must include every fetcher input.
import { useMemo } from 'react';
import { useApi } from '../context/AuthContext';
import { useCourseFilter } from '../context/CourseFilterContext';
import { useQueryStore } from '../context/DataContext';
import { useCourseStyles } from '../context/CourseStyleContext';
import { DEFAULT_COURSE_ICON, type CourseIconKey } from '../lib/courseIcons';
import { buildCourseColors, NEUTRAL_COURSE_COLOR } from '../lib/courseColor';
import { useQuery } from './useQuery';

export function useCourses() {
  const api = useApi();
  return useQuery('courses', api.getCourses);
}

/** Courses limited to the user's selection (Settings page). Use this in views; useCourses() is the full list. */
export function useVisibleCourses() {
  const result = useCourses();
  const { isVisible } = useCourseFilter();
  const data = useMemo(() => result.data?.filter((c) => isVisible(c.id)), [result.data, isVisible]);
  return { ...result, data };
}

/** `colorOf(courseId)`: that course's unique color (see lib/courseColor.ts) unless the user picked one in Settings. Based on the full course list, so Settings filters don't shift colors. */
export function useCourseColors(): (courseId: number) => string {
  const { data } = useCourses();
  const { styles } = useCourseStyles();
  const colors = useMemo(() => buildCourseColors((data ?? []).map((c) => c.id)), [data]);
  return (courseId) => styles[courseId]?.color ?? colors.get(courseId) ?? NEUTRAL_COURSE_COLOR;
}

/** `iconOf(courseId)`: the icon the user picked for that course (a book by default). */
export function useCourseIcons(): (courseId: number) => CourseIconKey {
  const { styles } = useCourseStyles();
  return (courseId) => styles[courseId]?.icon ?? DEFAULT_COURSE_ICON;
}

export function useCourse(courseId: number) {
  const api = useApi();
  return useQuery(`course:${courseId}`, () => api.getCourse(courseId));
}

export function useAssignments(courseId: number) {
  const api = useApi();
  return useQuery(`assignments:${courseId}`, () => api.getAssignments(courseId));
}

/** Assignments across several courses at once (one request per course, in parallel). */
export function useAllAssignments(courseIds: number[]) {
  const api = useApi();
  return useQuery(`assignments:all:${courseIds.join(',')}`, async () =>
    (await Promise.all(courseIds.map((id) => api.getAssignments(id)))).flat(),
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

export function useAssignmentGroups(courseId: number) {
  const api = useApi();
  return useQuery(`assignmentGroups:${courseId}`, () => api.getAssignmentGroups(courseId));
}

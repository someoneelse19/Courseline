// One-liner hooks per resource. Adding a feature = adding a function here
// (plus the endpoint in api/canvas.ts). Keys must include every fetcher input.
import { useMemo } from 'react';
import { useApi } from '../context/AuthContext';
import { useCourseFilter } from '../context/CourseFilterContext';
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
  return useQuery(`pages:${courseId}`, () => api.getPages(courseId));
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

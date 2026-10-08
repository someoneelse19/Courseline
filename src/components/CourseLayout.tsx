import { Suspense } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useCourse } from '../hooks/useCanvasData';
import { formatGrade, getGrade } from '../lib/format';
import { CourseTabs } from './CourseTabs';
import { ErrorMessage, PageTitle, Spinner } from './ui';

/** Shared header for everything inside one course: title, grade, tabs. Child routes render below. */
export function CourseLayout() {
  const courseId = Number(useParams().courseId);
  const course = useCourse(courseId);

  if (course.error) return <ErrorMessage error={course.error} onRetry={course.refetch} />;
  if (!course.data) return <Spinner />;

  return (
    <>
      <PageTitle>{course.data.name}</PageTitle>
      <p className="-mt-3 mb-4 text-sm text-neutral-500 dark:text-neutral-400">Current grade: {formatGrade(getGrade(course.data))}</p>
      <CourseTabs courseId={courseId} />
      {/* Tabs load on first visit; keep the course header up meanwhile. */}
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </>
  );
}

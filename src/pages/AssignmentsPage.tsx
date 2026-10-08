import { useState } from 'react';
import { AssignmentList } from '../components/AssignmentList';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useAssignments, useVisibleCourses } from '../hooks/useCanvasData';

// Stub: one course at a time. Canvas has no "all my assignments" endpoint, so a
// cross-course view means one request per course (watch rate limits) — or use
// /users/self/upcoming_events, /users/self/todo, or the Planner API
// (/planner/items) which aggregates server-side.
// TODO: aggregate view with filters (to-do / overdue / graded) via the Planner API.
export function AssignmentsPage() {
  const courses = useVisibleCourses();
  const [selected, setSelected] = useState<number | null>(null);

  if (courses.error) return <ErrorMessage error={courses.error} onRetry={courses.refetch} />;
  if (!courses.data) return <Spinner />;
  if (courses.data.length === 0) return <EmptyState>No courses to show. Pick some under “Choose courses”.</EmptyState>;

  const courseId = selected ?? courses.data[0].id;

  return (
    <>
      <PageTitle>Assignments</PageTitle>
      <select
        value={courseId}
        onChange={(e) => setSelected(Number(e.target.value))}
        className="mb-4 w-full max-w-sm rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      >
        {courses.data.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Card>
        <CourseAssignments courseId={courseId} />
      </Card>
    </>
  );
}

function CourseAssignments({ courseId }: { courseId: number }) {
  const { data, error, refetch } = useAssignments(courseId);
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return <Spinner />;
  return <AssignmentList assignments={data} />;
}

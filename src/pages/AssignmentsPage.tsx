import { useMemo, useState } from 'react';
import type { Assignment } from '../api/types';
import { AssignmentList } from '../components/AssignmentList';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useAllAssignments, useVisibleCourses } from '../hooks/useCanvasData';

// Canvas has no "all my assignments" endpoint, so this fans out one request per
// visible course (in parallel) and merges the results.
export function AssignmentsPage() {
  const courses = useVisibleCourses();

  if (courses.error) return <ErrorMessage error={courses.error} onRetry={courses.refetch} />;
  if (!courses.data) return <Spinner />;
  if (courses.data.length === 0) return <EmptyState>No courses to show. Pick some under “Choose courses”.</EmptyState>;

  return (
    <>
      <PageTitle>Assignments</PageTitle>
      <Card>
        <AllAssignments courses={courses.data} />
      </Card>
    </>
  );
}

type Tab = 'pending' | 'done';

/** Done = turned in, graded or excused. Everything else (including missing/past due) is still pending. */
function isDone(a: Assignment): boolean {
  const s = a.submission;
  if (!s) return false;
  return s.excused === true || s.workflow_state === 'graded' || s.workflow_state === 'submitted' || s.workflow_state === 'pending_review';
}

function AllAssignments({ courses }: { courses: { id: number; name: string }[] }) {
  const { data, error, refetch } = useAllAssignments(courses.map((c) => c.id));
  const names = useMemo(() => new Map(courses.map((c) => [c.id, c.name])), [courses]);
  const [tab, setTab] = useState<Tab>('pending');
  const { pending, done } = useMemo(() => {
    const all = data ?? [];
    return { pending: all.filter((a) => !isDone(a)), done: all.filter(isDone) };
  }, [data]);
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return <Spinner />;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'pending', label: 'Pending', count: pending.length },
    { id: 'done', label: 'Done', count: done.length },
  ];
  return (
    <>
      <div role="tablist" className="mb-2 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-300'
                : 'border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>
      <AssignmentList assignments={tab === 'pending' ? pending : done} courseNames={names} />
    </>
  );
}

import { useMemo, useState } from 'react';
import type { Course } from '../api/types';
import { AssignmentList } from '../components/AssignmentList';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { isDone, isMissing } from '../lib/assignmentState';
import { useUnreadFeedback } from '../hooks/useReadState';
import { useAuth } from '../context/AuthContext';
import { useAllAssignments, useVisibleCourses } from '../hooks/useCanvasData';
import { t } from '../i18n';

// Canvas has no "all my assignments" endpoint, so this fans out one request per
// visible course (in parallel) and merges the results.
export function AssignmentsPage() {
  const courses = useVisibleCourses();

  if (courses.error) return <ErrorMessage error={courses.error} onRetry={courses.refetch} />;
  if (!courses.data) return <Spinner />;
  if (courses.data.length === 0) return <EmptyState>{t('No courses to show. Pick some under “Choose courses”.')}</EmptyState>;

  return (
    <>
      <PageTitle>{t('Assignments')}</PageTitle>
      <Card>
        <AllAssignments courses={courses.data} />
      </Card>
    </>
  );
}

// Pending is everything not handed in, missing work first; Missing is only that work (it stays under Pending too).
type Tab = 'pending' | 'missing' | 'done';

function AllAssignments({ courses }: { courses: Course[] }) {
  const { data, error, refetch } = useAllAssignments(courses.map((c) => c.id));
  const names = useMemo(() => new Map(courses.map((c) => [c.id, c.name ?? c.course_code ?? `Course ${c.id}`])), [courses]);
  const [tab, setTab] = useState<Tab>('pending');
  const courseIds = useMemo(() => courses.map((c) => c.id), [courses]);
  const unread = useUnreadFeedback(useAuth().user?.id, courseIds);
  const lists = useMemo(() => {
    const all = data ?? [];
    return { pending: all.filter((a) => !isDone(a)), missing: all.filter(isMissing), done: all.filter(isDone) };
  }, [data]);
  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return <Spinner />;

  // Graded work sits under Done, so its tab shows when any of it has feedback not opened yet.
  const tabs: { id: Tab; label: string; count: number; unread: boolean }[] = [
    { id: 'pending', label: t('Pending'), count: lists.pending.length, unread: lists.pending.some(unread) },
    { id: 'missing', label: t('Missing'), count: lists.missing.length, unread: lists.missing.some(unread) },
    { id: 'done', label: t('Done'), count: lists.done.length, unread: lists.done.some(unread) },
  ];
  return (
    <>
      <div role="tablist" className="mb-2 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === tb.id
                ? 'border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-300'
                : 'border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            {tb.label}{' '}
            {/* Missing work counts in red, so it is seen from any tab. */}
            <span className={tb.id === 'missing' && tb.count > 0 ? 'text-red-600 dark:text-red-400' : ''}>({tb.count})</span>
            {tb.unread && (
              <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-accent-600 align-middle dark:bg-accent-400" title={t('New feedback')}>
                <span className="sr-only">{t('New feedback')}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <AssignmentList assignments={lists[tab]} courseNames={names} missingFirst={tab === 'pending'} empty={tab === 'missing' ? t('Nothing missing.') : undefined} />
    </>
  );
}

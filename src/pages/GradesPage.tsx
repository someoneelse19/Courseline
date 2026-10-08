import { GradeSummary } from '../components/GradeSummary';
import { Card, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useVisibleCourses } from '../hooks/useCanvasData';

export function GradesPage() {
  const { data, error, refetch } = useVisibleCourses();
  return (
    <>
      <PageTitle>Grades</PageTitle>
      <Card>
        {error ? <ErrorMessage error={error} onRetry={refetch} /> : !data ? <Spinner /> : <GradeSummary courses={data} />}
      </Card>
      <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
        Current grade counts graded work only. Open “Breakdown” for groups, a grade-over-time chart and what-if scores. “—” means your instructor hasn’t released a grade (or hides totals).
      </p>
    </>
  );
}

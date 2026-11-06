import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { AssignmentList } from '../components/AssignmentList';
import { Card, ErrorMessage, Spinner } from '../components/ui';
import { useAssignments } from '../hooks/useCanvasData';
import { markSeen } from '../lib/seen';
import { t } from '../i18n';

// The "Assignments" tab of a course. Header + tabs come from CourseLayout.
// TODO: more tabs — Announcements, Discussions, Syllabus (add in components/CourseTabs.tsx).
export function CourseDetailPage() {
  const courseId = Number(useParams().courseId);
  const assignments = useAssignments(courseId);
  // Opening the tab is seeing what is on it: the tab's dot goes.
  useEffect(() => {
    if (assignments.data) markSeen(courseId, 'assignments', assignments.data.map((a) => a.id));
  }, [courseId, assignments.data]);

  return (
    <Card title={t('Assignments')}>
      {assignments.error ? (
        <ErrorMessage error={assignments.error} onRetry={assignments.refetch} />
      ) : !assignments.data ? (
        <Spinner />
      ) : (
        <AssignmentList assignments={assignments.data} />
      )}
    </Card>
  );
}

import { useParams } from 'react-router-dom';
import { AssignmentList } from '../components/AssignmentList';
import { Card, ErrorMessage, Spinner } from '../components/ui';
import { useAssignments } from '../hooks/useCanvasData';

// The "Assignments" tab of a course. Header + tabs come from CourseLayout.
// TODO: more tabs — Announcements, Discussions, Syllabus (add in components/CourseTabs.tsx).
export function CourseDetailPage() {
  const courseId = Number(useParams().courseId);
  const assignments = useAssignments(courseId);

  return (
    <Card title="Assignments">
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

import { Link } from 'react-router-dom';
import { CourseCard } from '../components/CourseCard';
import { EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useVisibleCourses } from '../hooks/useCanvasData';

export function CoursesPage() {
  const { data, error, refetch } = useVisibleCourses();

  // TODO: group by term (course.term.name), add search, favorites (/users/self/favorites/courses)
  return (
    <>
      <PageTitle>Courses</PageTitle>
      {error ? (
        <ErrorMessage error={error} onRetry={refetch} />
      ) : !data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <EmptyState>
          No courses to show. <Link to="/settings" className="underline">Choose courses</Link>
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <CourseCard key={c.id} course={c} />
          ))}
        </div>
      )}
    </>
  );
}

import { Link } from 'react-router-dom';
import { CourseCard } from '../components/CourseCard';
import { GradeSummary } from '../components/GradeSummary';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useCourseFilter } from '../context/CourseFilterContext';
import { useVisibleCourses, useUpcoming } from '../hooks/useCanvasData';
import { courseIdFromContext, formatDue } from '../lib/format';

export function DashboardPage() {
  const { user } = useAuth();
  const courses = useVisibleCourses();
  const upcoming = useUpcoming();
  const { isVisible } = useCourseFilter();
  const upcomingVisible = upcoming.data?.filter((e) => isVisible(courseIdFromContext(e.context_code)));

  const courseName = (code?: string) => {
    const id = courseIdFromContext(code);
    return courses.data?.find((c) => c.id === id)?.name;
  };

  return (
    <>
      <PageTitle>Welcome{user ? `, ${user.short_name ?? user.name}` : ''}</PageTitle>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Upcoming assignments">
            {upcoming.error ? (
              <ErrorMessage error={upcoming.error} onRetry={upcoming.refetch} />
            ) : !upcomingVisible ? (
              <Spinner />
            ) : upcomingVisible.length === 0 ? (
              <EmptyState>Nothing due soon 🎉</EmptyState>
            ) : (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {upcomingVisible.map((e) => (
                  <li key={e.id} className="py-3">
                    {e.assignment ? (
                      <Link to={`/courses/${e.assignment.course_id}/assignments/${e.assignment.id}`} className="font-medium hover:underline">
                        {e.title}
                      </Link>
                    ) : (
                      <a href={e.html_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                        {e.title}
                      </a>
                    )}
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {[courseName(e.context_code), formatDue(e.assignment?.due_at ?? e.start_at)].filter(Boolean).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Courses" action={<Link to="/courses" className="text-sm text-accent-600 hover:underline dark:text-accent-400">View all</Link>}>
            {courses.error ? (
              <ErrorMessage error={courses.error} onRetry={courses.refetch} />
            ) : !courses.data ? (
              <Spinner />
            ) : courses.data.length === 0 ? (
              <EmptyState>No active courses.</EmptyState>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {courses.data.slice(0, 4).map((c) => (
                  <CourseCard key={c.id} course={c} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Grades" action={<Link to="/grades" className="text-sm text-accent-600 hover:underline dark:text-accent-400">Details</Link>}>
          {courses.error ? (
            <ErrorMessage error={courses.error} onRetry={courses.refetch} />
          ) : !courses.data ? (
            <Spinner />
          ) : (
            <GradeSummary courses={courses.data} />
          )}
        </Card>
      </div>
    </>
  );
}

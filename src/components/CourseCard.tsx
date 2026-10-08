import { Link } from 'react-router-dom';
import type { Course } from '../api/types';
import { formatGrade, getGrade } from '../lib/format';

// Canvas has no per-course color via this endpoint (that's /users/self/colors),
// so derive a stable accent from the course id. TODO: use /users/self/colors.
const accents = ['bg-accent-500', 'bg-emerald-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-fuchsia-500'];

export function CourseCard({ course }: { course: Course }) {
  const grade = getGrade(course);
  return (
    <Link
      to={`/courses/${course.id}`}
      className="block overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className={`h-2 ${accents[course.id % accents.length]}`} />
      <div className="p-4">
        <h3 className="truncate font-semibold">{course.name}</h3>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {[course.course_code, course.term?.name].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">Grade: {formatGrade(grade)}</p>
      </div>
    </Link>
  );
}

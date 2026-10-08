import { Link } from 'react-router-dom';
import type { Course } from '../api/types';
import { CourseIcon } from './icons';
import { useCourseColors } from '../hooks/useCanvasData';
import { formatGrade, getGrade } from '../lib/format';
import { t } from '../i18n';

export function CourseCard({ course }: { course: Course }) {
  const colorOf = useCourseColors();
  const grade = getGrade(course);
  return (
    <Link
      to={`/courses/${course.id}`}
      className="block overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="h-2" style={{ backgroundColor: colorOf(course.id) }} />
      <div className="p-4">
        <h3 className="flex items-center gap-2 font-semibold">
          <CourseIcon courseId={course.id} className="h-5 w-5" />
          <span className="truncate">{course.name}</span>
        </h3>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {[course.course_code, course.term?.name].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-300">{t('Grade: {grade}', { grade: formatGrade(grade) })}</p>
      </div>
    </Link>
  );
}

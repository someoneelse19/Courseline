import { Link } from 'react-router-dom';
import type { Course } from '../api/types';
import { formatGrade, getGrade } from '../lib/format';
import { EmptyState } from './ui';

export function GradeSummary({ courses }: { courses: Course[] }) {
  if (courses.length === 0) return <EmptyState>No courses yet.</EmptyState>;

  return (
    <ul className="space-y-3">
      {courses.map((c) => {
        const g = getGrade(c);
        return (
          <li key={c.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <Link to={`/courses/${c.id}`} className="truncate hover:underline">
                {c.name}
              </Link>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="font-medium">{formatGrade(g)}</span>
                <Link to={`/courses/${c.id}/grades`} className="text-xs text-accent-600 hover:underline dark:text-accent-400">
                  Breakdown →
                </Link>
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.min(g.score ?? 0, 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

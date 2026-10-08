import { Link } from 'react-router-dom';
import type { Assignment } from '../api/types';
import { formatDue, isPast } from '../lib/format';
import { EmptyState } from './ui';

export function assignmentStatus(a: Assignment): { label: string; className: string } {
  const s = a.submission;
  if (s?.excused) return { label: 'Excused', className: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300' };
  if (s?.workflow_state === 'graded' && s.score != null)
    return { label: `${s.score}/${a.points_possible ?? '?'}`, className: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' };
  if (s?.missing) return { label: 'Missing', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' };
  if (s?.workflow_state === 'submitted' || s?.workflow_state === 'pending_review')
    return { label: s.late ? 'Submitted (late)' : 'Submitted', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' };
  if (isPast(a.due_at)) return { label: 'Past due', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
  return { label: 'To do', className: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300' };
}

/** Sorted: dated assignments by due date first, undated last. */
export function AssignmentList({
  assignments,
  courseNames,
}: {
  assignments: Assignment[];
  /** When given, each row shows its course name (for lists spanning several courses). */
  courseNames?: ReadonlyMap<number, string>;
}) {
  if (assignments.length === 0) return <EmptyState>No assignments.</EmptyState>;

  const sorted = [...assignments].sort((a, b) => {
    if (!a.due_at) return 1;
    if (!b.due_at) return -1;
    return a.due_at.localeCompare(b.due_at);
  });

  return (
    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {sorted.map((a) => {
        const st = assignmentStatus(a);
        return (
          <li key={a.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <Link to={`/courses/${a.course_id}/assignments/${a.id}`} className="block truncate font-medium hover:underline">
                {a.name}
              </Link>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{courseNames?.get(a.course_id) && `${courseNames.get(a.course_id)} · `}
                {formatDue(a.due_at)}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.className}`}>{st.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

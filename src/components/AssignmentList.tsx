import { Link } from 'react-router-dom';
import type { Assignment } from '../api/types';
import { useCourseColors } from '../hooks/useCanvasData';
import { assignmentTone, isFaded, isSubmittedUndated, sortAssignments, TONE_CLASSES } from '../lib/assignmentState';
import { formatDay, formatDue, isPast } from '../lib/format';
import { EmptyState } from './ui';
import { t } from '../i18n';

/** The badge for an assignment. Its color is the same scheme as the calendar (lib/assignmentState.ts). */
export function assignmentStatus(a: Assignment): { label: string; className: string } {
  const s = a.submission;
  const className = TONE_CLASSES[assignmentTone(a)];
  if (s?.excused) return { label: t('Excused'), className };
  if (s?.workflow_state === 'graded' && s.score != null) return { label: `${s.score}/${a.points_possible ?? '?'}`, className };
  if (s?.missing) return { label: t('Missing'), className };
  if (s?.workflow_state === 'submitted' || s?.workflow_state === 'pending_review')
    return { label: s.late ? t('Submitted (late)') : t('Submitted'), className };
  if (isPast(a.due_at)) return { label: t('Past due'), className };
  return { label: t('To do'), className };
}

/** Sorted by relevance (see sortAssignments): upcoming soonest first, then past most recent first, undated last. */
export function AssignmentList({
  assignments,
  courseNames,
}: {
  assignments: Assignment[];
  /** When given, each row shows its course name (for lists spanning several courses). */
  courseNames?: ReadonlyMap<number, string>;
}) {
  const colorOf = useCourseColors();
  if (assignments.length === 0) return <EmptyState>{t('No assignments.')}</EmptyState>;

  const sorted = sortAssignments(assignments);

  return (
    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {sorted.map((a) => {
        const st = assignmentStatus(a);
        return (
          <li key={a.id} className={`flex items-center justify-between gap-3 py-3 ${isFaded(a) ? 'opacity-50' : ''}`}>
            <div className="min-w-0">
              <Link to={`/courses/${a.course_id}/assignments/${a.id}`} className="block truncate font-medium hover:underline">
                {a.name}
              </Link>
              <p className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                {courseNames?.has(a.course_id) && (
                  <>
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(a.course_id) }} />
                    <span className="truncate">{courseNames.get(a.course_id)}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span className="shrink-0">
                  {isSubmittedUndated(a)
                    ? t('No due date · submitted {date}', { date: formatDay(a.submission!.submitted_at) })
                    : a.due_at || !(a.created_at ?? a.unlock_at)
                      ? formatDue(a.due_at)
                      : t('No due date · posted {date}', { date: formatDay(a.created_at ?? a.unlock_at) })}
                </span>
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.className}`}>{st.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

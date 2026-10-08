import type { Course } from '../api/types';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDue(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : 'No due date';
}

export function isPast(iso: string | null | undefined): boolean {
  return !!iso && new Date(iso).getTime() < Date.now();
}

export interface Grade {
  score: number | null; // percent
  letter: string | null;
}

/**
 * The user's grade for a course, from the student enrollment.
 * QUIRK: both fields are null when the instructor hides totals or nothing is
 * graded yet — render "—", don't treat it as 0%.
 */
export function getGrade(course: Course): Grade {
  const e = course.enrollments?.find((x) => x.type === 'student');
  return { score: e?.computed_current_score ?? null, letter: e?.computed_current_grade ?? null };
}

export function formatGrade(g: Grade): string {
  if (g.score === null) return '—';
  return g.letter ? `${g.score.toFixed(1)}% (${g.letter})` : `${g.score.toFixed(1)}%`;
}

/** "course_123" → 123 (used with upcoming_events' context_code). */
export function courseIdFromContext(code: string | undefined): number | null {
  const m = code?.match(/^course_(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDay(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

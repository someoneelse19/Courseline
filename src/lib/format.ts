import type { Course } from '../api/types';
import { getLocale, t } from '../i18n';
import { withClock } from './systemClock';

// Formatters follow the app language (not just the browser's) and the computer's 12/24-hour clock, cached per language.
const formatters = new Map<string, Intl.DateTimeFormat>();
function dateFmt(): Intl.DateTimeFormat {
  const locale = getLocale();
  let fmt = formatters.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, withClock({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
    formatters.set(locale, fmt);
  }
  return fmt;
}

export function formatDue(iso: string | null | undefined): string {
  return iso ? dateFmt().format(new Date(iso)) : t('No due date');
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
  return iso ? new Date(iso).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

/** "5 minutes ago", "yesterday": relative time in the app's language. */
export function formatAgo(thenMs: number, nowMs: number = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const seconds = Math.round((thenMs - nowMs) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}

/** The same, short enough for a narrow column: "now", "9 min", "3 hr", "2 days" (in the app's language). */
export function formatAgoShort(thenMs: number, nowMs: number = Date.now()): string {
  const abs = Math.abs(Math.round((nowMs - thenMs) / 1000));
  const unit = (value: number, u: 'minute' | 'hour' | 'day') => new Intl.NumberFormat(getLocale(), { style: 'unit', unit: u, unitDisplay: 'short' }).format(value);
  if (abs < 45) return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' }).format(0, 'second');
  if (abs < 3600) return unit(Math.round(abs / 60), 'minute');
  if (abs < 86400) return unit(Math.round(abs / 3600), 'hour');
  return unit(Math.round(abs / 86400), 'day');
}

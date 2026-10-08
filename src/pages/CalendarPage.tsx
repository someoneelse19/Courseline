import { useMemo, useState } from 'react';
import type { Assignment, Course } from '../api/types';
import { AssignmentList } from '../components/AssignmentList';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useAllAssignments, useCourseColors, useVisibleCourses } from '../hooks/useCanvasData';
import { getLanguage, t } from '../i18n';
import { assignmentTone, isFaded, TONE_CLASSES, type Tone } from '../lib/assignmentState';
import { dateKey, monthGrid } from '../lib/calendar';

// A month view of everything due, across the visible courses. Click a day to list its assignments.
// Only assignments with a due date appear (Canvas calendar events are not included yet).

const MAX_CHIPS = 3;

export function CalendarPage() {
  const courses = useVisibleCourses();

  if (courses.error) return <ErrorMessage error={courses.error} onRetry={courses.refetch} />;
  if (!courses.data) return <Spinner />;
  if (courses.data.length === 0) return <EmptyState>{t('No courses to show. Pick some under “Choose courses”.')}</EmptyState>;

  return (
    <>
      <PageTitle>{t('Calendar')}</PageTitle>
      <Month courses={courses.data} />
    </>
  );
}

function Month({ courses }: { courses: Course[] }) {
  const { data, error, refetch } = useAllAssignments(courses.map((c) => c.id));
  const colorOf = useCourseColors();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(dateKey(today));

  const names = useMemo(() => new Map(courses.map((c) => [c.id, c.name ?? c.course_code ?? `Course ${c.id}`])), [courses]);
  const byDay = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const a of data ?? []) {
      if (!a.due_at) continue;
      const key = dateKey(new Date(a.due_at));
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [data]);

  if (error) return <ErrorMessage error={error} onRetry={refetch} />;
  if (!data) return <Spinner />;

  const language = getLanguage();
  const weekStart = language === 'es' ? 1 : 0;
  const days = monthGrid(cursor.year, cursor.month, weekStart);
  const todayKey = dateKey(today);
  // 2023-01-01 was a Sunday: a fixed reference for the weekday names.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + ((i + weekStart) % 7)).toLocaleDateString(language, { weekday: 'short' }),
  );
  const title = new Date(cursor.year, cursor.month, 1).toLocaleDateString(language, { month: 'long', year: 'numeric' });

  const go = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const goToday = () => {
    setCursor({ year: today.getFullYear(), month: today.getMonth() });
    setSelected(todayKey);
  };

  const nav = 'rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';
  const selectedItems = byDay.get(selected) ?? [];
  const selectedLabel = new Date(`${selected}T12:00:00`).toLocaleDateString(language, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold capitalize">{title}</h2>
          <button type="button" onClick={() => go(-1)} aria-label={t('Previous month')} className={nav}>
            ←
          </button>
          <button type="button" onClick={goToday} className={nav}>
            {t('Today')}
          </button>
          <button type="button" onClick={() => go(1)} aria-label={t('Next month')} className={nav}>
            →
          </button>
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 text-xs dark:border-neutral-800 dark:bg-neutral-800">
          {weekdays.map((w) => (
            <div key={w} className="bg-neutral-50 px-1 py-1.5 text-center font-medium capitalize text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const key = dateKey(d);
            const items = byDay.get(key) ?? [];
            const inMonth = d.getMonth() === cursor.month;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={selected === key}
                aria-label={`${d.toLocaleDateString(language, { weekday: 'long', month: 'long', day: 'numeric' })}${
                  items.length ? `, ${items.length === 1 ? t('1 assignment') : t('{n} assignments', { n: items.length })}` : ''
                }`}
                className={`flex min-h-20 flex-col items-stretch gap-0.5 bg-white p-1 text-left align-top hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800 ${
                  inMonth ? '' : 'opacity-50'
                } ${selected === key ? 'ring-2 ring-inset ring-accent-500' : ''}`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center self-end rounded-full text-[11px] ${
                    key === todayKey ? 'bg-accent-600 font-semibold text-white' : 'text-neutral-600 dark:text-neutral-300'
                  }`}
                >
                  {d.getDate()}
                </span>
                {items.slice(0, MAX_CHIPS).map((a) => (
                  <span
                    key={a.id}
                    title={`${names.get(a.course_id) ?? ''}: ${a.name}`}
                    className={`flex items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] leading-tight ${TONE_CLASSES[assignmentTone(a)]} ${isFaded(a) ? 'opacity-50' : ''}`}
                  >
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(a.course_id) }} />
                    <span className="truncate">{a.name}</span>
                  </span>
                ))}
                {items.length > MAX_CHIPS && (
                  <span className="px-1 text-[11px] text-neutral-500 dark:text-neutral-400">{t('+{n} more', { n: items.length - MAX_CHIPS })}</span>
                )}
              </button>
            );
          })}
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={t('Status colors')}>
          {(
            [
              ['missing', t('Missing')],
              ['todo', t('To do')],
              ['done', t('Submitted')],
            ] as [Tone, string][]
          ).map(([tone, label]) => (
            <li key={tone} className={`rounded-sm px-1.5 py-0.5 ${TONE_CLASSES[tone]}`}>
              {label}
            </li>
          ))}
          <li className="px-1.5 py-0.5 text-neutral-500 dark:text-neutral-400">{t('Faded = submitted and past due')}</li>
        </ul>

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300" aria-label={t('Courses')}>
          {courses.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorOf(c.id) }} />
              {names.get(c.id)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={selectedLabel}>
        {selectedItems.length === 0 ? (
          <EmptyState>{t('Nothing due on this day.')}</EmptyState>
        ) : (
          <AssignmentList assignments={selectedItems} courseNames={names} />
        )}
      </Card>
    </div>
  );
}

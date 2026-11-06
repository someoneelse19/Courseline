import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Assignment } from '../api/types';
import { GradeTrendChart, type TrendDatum } from '../components/GradeTrendChart';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAssignmentGroups, useCourse } from '../hooks/useCanvasData';
import { assignmentTone, TONE_CLASSES } from '../lib/assignmentState';
import { classPercentile, computeGrade, gradeTrend, medianComparison, toModel, type QuantileStats } from '../lib/grades';
import { formatDay } from '../lib/format';
import { t } from '../i18n';

// Per-course grades: how the grade has moved, with the current grade, the work status and the class percentile beside
// it, then every assignment with a what-if calculator. All the maths lives in lib/grades.ts.

type Filter = 'all' | 'graded' | 'missing' | 'pending';

const pct = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${n.toFixed(digits)}%`);
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const sign = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

function rowStatus(a: Assignment | undefined, graded: boolean): { label: string; className: string } {
  const s = a?.submission;
  // Same colors as the calendar and every other assignment list (lib/assignmentState.ts).
  const className = TONE_CLASSES[graded ? 'done' : a ? assignmentTone(a) : 'todo'];
  if (s?.excused) return { label: t('Excused'), className };
  if (graded) return { label: s?.late ? t('Graded · late') : t('Graded'), className };
  if (s?.missing) return { label: t('Missing'), className };
  if (s?.workflow_state === 'submitted' || s?.workflow_state === 'pending_review') return { label: t('Awaiting grade'), className };
  if (a?.due_at && new Date(a.due_at).getTime() < Date.now()) return { label: t('Past due'), className };
  return { label: t('To do'), className };
}

function Tile({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-sm text-neutral-500 dark:text-neutral-400">{label}</p>
      <div className="mt-1">{children}</div>
      {note && <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{note}</p>}
    </div>
  );
}

export function CourseGradesPage() {
  const courseId = Number(useParams().courseId);
  const course = useCourse(courseId);
  const groupsQ = useAssignmentGroups(courseId);
  const [overrides, setOverrides] = useState<Record<number, number | null>>({});
  const [filter, setFilter] = useState<Filter>('all');

  const weighted = !!course.data?.apply_assignment_group_weights;
  const model = useMemo(() => (groupsQ.data ? toModel(groupsQ.data) : null), [groupsQ.data]);
  const byId = useMemo(() => {
    const m = new Map<number, Assignment>();
    for (const g of groupsQ.data ?? []) for (const a of g.assignments ?? []) m.set(a.id, a);
    return m;
  }, [groupsQ.data]);

  const hasWhatIf = Object.keys(overrides).length > 0;
  const real = useMemo(() => (model ? computeGrade(model.groups, model.items, { weighted }) : null), [model, weighted]);
  const whatIf = useMemo(() => (model && hasWhatIf ? computeGrade(model.groups, model.items, { weighted, overrides }) : null), [model, weighted, overrides, hasWhatIf]);
  const trend = useMemo<TrendDatum[]>(
    () =>
      model
        ? gradeTrend(model.groups, model.items, weighted).map((p) => ({
            name: p.item.name,
            running: p.running,
            score: p.item.score ?? 0,
            points: p.item.points,
            date: p.item.gradedAt ?? p.item.dueAt,
          }))
        : [],
    [model, weighted],
  );
  const comparison = useMemo(() => {
    if (!model) return null;
    const medians = new Map<number, number>();
    const stats = new Map<number, QuantileStats>();
    for (const [id, a] of byId) {
      if (!a.score_statistics) continue;
      medians.set(id, a.score_statistics.median);
      stats.set(id, a.score_statistics);
    }
    if (!medians.size) return null;
    return { ...medianComparison(model.groups, model.items, weighted, medians), percentile: classPercentile(model.groups, model.items, weighted, stats).percentile };
  }, [model, byId, weighted]);

  if (groupsQ.error) return <ErrorMessage error={groupsQ.error} onRetry={groupsQ.refetch} />;
  if (!model || !real || !course.data) return <Spinner />;
  if (model.items.length === 0) return <EmptyState>{t('No graded assignments in this course yet.')}</EmptyState>;

  const enrollment = course.data.enrollments?.find((e) => e.type === 'student');
  // An estimate (the extension worked it out, Canvas's own total was not seen) is not Canvas's figure.
  const canvasCurrent = enrollment?.estimated ? null : (enrollment?.computed_current_score ?? null);
  const headline = canvasCurrent ?? real.current;
  // Our maths mirrors Canvas, but if it ever disagrees (rules we don't model), say so instead of hiding it.
  const mismatch = canvasCurrent != null && real.current != null && Math.abs(canvasCurrent - real.current) > 0.6;

  const kind = (id: number): Exclude<Filter, 'all'> => {
    const item = model.items.find((i) => i.id === id)!;
    if (item.score != null) return 'graded';
    return byId.get(id)?.submission?.missing ? 'missing' : 'pending';
  };
  const counts = { graded: 0, missing: 0, pending: 0 };
  for (const i of model.items) if (!i.excused && !i.omitted) counts[kind(i.id)]++;

  const setScore = (id: number, raw: string) =>
    setOverrides((o) => {
      const next = { ...o };
      if (raw.trim() === '' || Number.isNaN(Number(raw))) delete next[id];
      else next[id] = Math.max(0, Number(raw));
      return next;
    });

  const hasStats = [...byId.values()].some((a) => a.score_statistics);
  const filters: { key: Filter; label: string; n: number }[] = [
    { key: 'all', label: t('All'), n: model.items.length },
    { key: 'graded', label: t('Graded'), n: counts.graded },
    { key: 'missing', label: t('Missing'), n: counts.missing },
    { key: 'pending', label: t('Not graded yet'), n: counts.pending },
  ];
  const input = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:placeholder:text-neutral-600';

  return (
    <div className="space-y-6">
      {/* The grade over time, with the headline numbers beside it */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t('Grade over time')} className="flex flex-col lg:col-span-2">
          <p className="-mt-2 mb-2 text-xs text-neutral-500 dark:text-neutral-400">{t('Your current grade over time: it changes on the day each assignment is graded.')}</p>
          {trend.length < 2 ? <EmptyState>{t('Not enough graded work yet to show a trend.')}</EmptyState> : <GradeTrendChart data={trend} />}
        </Card>

        <div className="flex flex-col gap-3">
          <Tile
            label={t('Current grade')}
            note={
              <>
                {enrollment?.computed_current_grade ? `${enrollment.computed_current_grade} · ` : ''}{t('graded work only')}
                {mismatch && <span className="block">{t('Rebuilt here from your scores: {value}', { value: pct(real.current) })}</span>}
                {enrollment?.estimated && <span className="block">{t('Worked out by Courseline from the scores it has seen')}</span>}
              </>
            }
          >
            <p className="text-5xl font-semibold tracking-tight">{pct(headline)}</p>
          </Tile>
          <Tile label={t('Work status')}>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                [t('Graded'), counts.graded],
                [t('Missing'), counts.missing],
                [t('Not graded'), counts.pending],
              ].map(([k, v]) => (
                <div key={k}>
                  <dd className="text-2xl font-semibold">{v}</dd>
                  <dt className="text-xs text-neutral-500 dark:text-neutral-400">{k}</dt>
                </div>
              ))}
            </dl>
          </Tile>
          {comparison?.percentile != null && comparison.median != null && (
            <Tile
              label={t('Class percentile (estimate)')}
              note={
                <>
                  {t('Class median grade about {value}', { value: pct(comparison.median) })}
                  {comparison.you != null && ` · ${t('You are {delta} points vs the median', { delta: sign(comparison.you - comparison.median) })}`}
                  {comparison.covered < comparison.graded && (
                    <span className="block">{t('Based on {n} of {total} graded assignments that show class statistics', { n: comparison.covered, total: comparison.graded })}</span>
                  )}
                </>
              }
            >
              <p className="text-3xl font-semibold tracking-tight">{Math.round(comparison.percentile)}</p>
            </Tile>
          )}
        </div>
      </div>

      {/* Assignments + what-if */}
      <Card
        title={t('Assignments')}
        action={
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('Filter assignments')}>
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs ${
                  filter === f.key ? 'bg-accent-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                }`}
              >
                {f.label} · {f.n}
              </button>
            ))}
          </div>
        }
      >
        {whatIf && (
          <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm dark:border-accent-900 dark:bg-accent-950">
            <span>
              <strong>{t('What-if:')}</strong> {t('current')} <strong>{pct(whatIf.current)}</strong>
              {whatIf.current != null && real.current != null && <span className="text-neutral-600 dark:text-neutral-300"> ({t('{delta} vs now', { delta: sign(whatIf.current - real.current) })})</span>}
              {' · '}{t('if the rest were zero')} <strong>{pct(whatIf.final)}</strong>
            </span>
            <button type="button" onClick={() => setOverrides({})} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-white dark:border-neutral-700 dark:hover:bg-neutral-900">
              {t('Reset what-ifs')}
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="py-2 pr-3 font-medium">{t('Assignment')}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">{t('Due')}</th>
                <th className="px-3 py-2 font-medium">{t('Status')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Score')}</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">%</th>
                {hasStats && <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">{t('Class median')}</th>}
                <th className="py-2 pl-3 text-right font-medium">{t('What-if (points)')}</th>
              </tr>
            </thead>
            {model.groups.map((g) => {
              const rows = model.items
                .filter((i) => i.groupId === g.id && (filter === 'all' || kind(i.id) === filter))
                .sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9') || a.id - b.id);
              if (rows.length === 0) return null;
              const dropped = real.groups[g.id].current.dropped;
              return (
                <tbody key={g.id} className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  <tr>
                    <th colSpan={hasStats ? 7 : 6} className="bg-neutral-50 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-950 dark:text-neutral-400">
                      {g.name}
                      {weighted && g.weight > 0 ? ` · ${g.weight}%` : ''}
                    </th>
                  </tr>
                  {rows.map((i) => {
                    const a = byId.get(i.id);
                    const st = rowStatus(a, i.score != null);
                    const isDropped = dropped.includes(i.id);
                    const stats = a?.score_statistics;
                    return (
                      <tr key={i.id} className={i.excused || i.omitted ? 'text-neutral-400' : ''}>
                        <td className="py-2 pr-3">
                          <Link to={`/courses/${courseId}/assignments/${i.id}`} className="font-medium hover:underline">
                            {i.name}
                          </Link>
                          {isDropped && <span className="ml-2 rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t('dropped')}</span>}
                          {i.omitted && <span className="ml-2 text-[11px] text-neutral-500">{t('not in final grade')}</span>}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-neutral-500 dark:text-neutral-400 md:table-cell">{i.dueAt ? formatDay(i.dueAt) : '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${st.className}`}>{st.label}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {i.score != null ? pts(i.score) : '—'} / {pts(i.points)}
                        </td>
                        <td className="hidden px-3 py-2 text-right font-medium tabular-nums sm:table-cell">{i.score != null && i.points > 0 ? pct((i.score / i.points) * 100, 0) : '—'}</td>
                        {hasStats && (
                          <td className="hidden whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400 lg:table-cell">
                            {stats ? (
                              <>
                                {pts(stats.median)}
                                {i.score != null && <span className="ml-1 text-xs">({sign(i.score - stats.median)})</span>}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        <td className="py-2 pl-3 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            aria-label={t('What-if score for {name}', { name: i.name })}
                            placeholder={i.score != null ? pts(i.score) : '—'}
                            value={overrides[i.id] ?? ''}
                            disabled={i.excused || i.omitted}
                            onChange={(e) => setScore(i.id, e.target.value)}
                            className={`${input} w-20 text-right tabular-nums disabled:opacity-40`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {t('What-if scores are only for planning: they never leave this page. Totals are calculated the way Canvas does it (group weights and drop rules included).')}
        </p>
      </Card>
    </div>
  );
}

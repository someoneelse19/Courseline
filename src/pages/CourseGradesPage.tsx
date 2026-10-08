import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Assignment } from '../api/types';
import { GradeTrendChart, type TrendDatum } from '../components/GradeTrendChart';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAssignmentGroups, useCourse } from '../hooks/useCanvasData';
import { computeGrade, gradeTrend, neededAverage, toModel } from '../lib/grades';
import { formatDay } from '../lib/format';

// Per-course grade breakdown: headline numbers, how the grade has moved, how each assignment group
// contributes, and a what-if / goal calculator. All the maths lives in lib/grades.ts.

type Filter = 'all' | 'graded' | 'missing' | 'pending';

const pct = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${n.toFixed(digits)}%`);
const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const sign = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;

function rowStatus(a: Assignment | undefined, graded: boolean): { label: string; className: string } {
  const s = a?.submission;
  const neutral = 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300';
  if (s?.excused) return { label: 'Excused', className: neutral };
  if (graded) return s?.late ? { label: 'Graded · late', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' } : { label: 'Graded', className: neutral };
  if (s?.missing) return { label: 'Missing', className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' };
  if (s?.workflow_state === 'submitted' || s?.workflow_state === 'pending_review')
    return { label: 'Awaiting grade', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' };
  if (a?.due_at && new Date(a.due_at).getTime() < Date.now()) return { label: 'Past due', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' };
  return { label: 'To do', className: neutral };
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
  const [target, setTarget] = useState(90);

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
  const goal = useMemo(() => (model ? neededAverage(model.groups, model.items, { weighted, overrides }, target) : null), [model, weighted, overrides, target]);

  if (groupsQ.error) return <ErrorMessage error={groupsQ.error} onRetry={groupsQ.refetch} />;
  if (!model || !real || !course.data) return <Spinner />;
  if (model.items.length === 0) return <EmptyState>No graded assignments in this course yet.</EmptyState>;

  const enrollment = course.data.enrollments?.find((e) => e.type === 'student');
  const canvasCurrent = enrollment?.computed_current_score ?? null;
  const canvasFinal = enrollment?.computed_final_score ?? null;
  const headline = canvasCurrent ?? real.current;
  const finalHeadline = canvasFinal ?? real.final;
  // Our maths mirrors Canvas, but if it ever disagrees (rules we don't model), say so instead of hiding it.
  const mismatch = canvasCurrent != null && real.current != null && Math.abs(canvasCurrent - real.current) > 0.6;

  let earned = 0;
  let possible = 0;
  for (const g of model.groups) {
    earned += real.groups[g.id].current.earned;
    possible += real.groups[g.id].current.possible;
  }

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
    { key: 'all', label: 'All', n: model.items.length },
    { key: 'graded', label: 'Graded', n: counts.graded },
    { key: 'missing', label: 'Missing', n: counts.missing },
    { key: 'pending', label: 'Not graded yet', n: counts.pending },
  ];
  const input = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:placeholder:text-neutral-600';

  return (
    <div className="space-y-6">
      {/* Headline numbers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Current grade"
          note={
            <>
              {enrollment?.computed_current_grade ? `${enrollment.computed_current_grade} · ` : ''}graded work only
              {mismatch && <span className="block">Rebuilt here from your scores: {pct(real.current)}</span>}
            </>
          }
        >
          <p className="text-5xl font-semibold tracking-tight">{pct(headline)}</p>
        </Tile>
        <Tile label="If the rest were zero" note={counts.pending + counts.missing === 0 ? 'Everything is graded' : 'Ungraded work counts as 0'}>
          <p className="text-3xl font-semibold tracking-tight">{pct(finalHeadline)}</p>
        </Tile>
        <Tile label="Points" note={weighted ? 'Graded work; the course weights groups' : 'Graded work'}>
          <p className="text-3xl font-semibold tracking-tight">
            {pts(earned)} <span className="text-lg font-normal text-neutral-500 dark:text-neutral-400">/ {pts(possible)}</span>
          </p>
        </Tile>
        <Tile label="Work status">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Graded', counts.graded],
              ['Missing', counts.missing],
              ['Not graded', counts.pending],
            ].map(([k, v]) => (
              <div key={k}>
                <dd className="text-2xl font-semibold">{v}</dd>
                <dt className="text-xs text-neutral-500 dark:text-neutral-400">{k}</dt>
              </div>
            ))}
          </dl>
        </Tile>
      </div>

      {/* Trend */}
      <Card title="Grade over time">
        <p className="-mt-2 mb-2 text-xs text-neutral-500 dark:text-neutral-400">Your current grade after each graded assignment, in the order they were graded.</p>
        {trend.length < 2 ? <EmptyState>Not enough graded work yet to show a trend.</EmptyState> : <GradeTrendChart data={trend} />}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Groups */}
        <div className="lg:col-span-2">
          <Card title="By assignment group">
            <ul className="space-y-4">
              {model.groups.map((g) => {
                const s = real.groups[g.id].current;
                const dropRule = [g.dropLowest && `lowest ${g.dropLowest}`, g.dropHighest && `highest ${g.dropHighest}`].filter(Boolean).join(' and ');
                return (
                  <li key={g.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{g.name}</span>
                      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                        {weighted && g.weight > 0 ? `${g.weight}% of grade` : ''}
                        {weighted && g.weight > 0 && s.pct != null ? ` · counts ${((g.weight * s.pct) / 100).toFixed(1)} of ${g.weight}` : ''}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      {/* Track is a lighter step of the bar's own ramp; 12px thick, square at the baseline, 4px round data end. */}
                      <div className="h-3 flex-1 rounded-r-[4px] bg-accent-100 dark:bg-accent-950">
                        {s.pct != null && (
                          <div className="h-full rounded-r-[4px] bg-accent-600" style={{ width: `${Math.max(0, Math.min(s.pct, 100))}%` }} role="img" aria-label={`${pct(s.pct)} in ${g.name}`} />
                        )}
                      </div>
                      <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{pct(s.pct)}</span>
                    </div>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {s.counted === 0 ? 'No graded work yet' : `${pts(s.earned)} / ${pts(s.possible)} points`}
                      {dropRule && ` · drops your ${dropRule} score${g.dropLowest + g.dropHighest > 1 ? 's' : ''}`}
                      {s.dropped.length > 0 && ` · ${s.dropped.length} dropped`}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* Goal */}
        <Card title="Set a goal">
          <label className="flex items-center gap-2 text-sm">
            I want a final grade of
            <input type="number" min={0} max={200} value={target} onChange={(e) => setTarget(Number(e.target.value) || 0)} className={`${input} w-20`} />%
          </label>
          <p className="mt-3 text-sm" role="status">
            {goal?.status === 'none' && 'Nothing left to grade, so your grade is final.'}
            {goal?.status === 'secured' && `Already secured: even zeros on the remaining ${goal.remaining} assignment${goal.remaining === 1 ? '' : 's'} keep you at or above ${target}%.`}
            {goal?.status === 'reachable' && (
              <>
                You need an average of <strong>{pct(goal.needed)}</strong> across the remaining {goal.remaining} assignment{goal.remaining === 1 ? '' : 's'}.
              </>
            )}
            {goal?.status === 'unreachable' && `Out of reach: perfect scores on the remaining ${goal.remaining} would give ${pct(goal.bestPossible)}.`}
          </p>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Uses your real scores plus any what-if scores you enter below.</p>
        </Card>
      </div>

      {/* Assignments + what-if */}
      <Card
        title="Assignments"
        action={
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter assignments">
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
              <strong>What-if:</strong> current <strong>{pct(whatIf.current)}</strong>
              {whatIf.current != null && real.current != null && <span className="text-neutral-600 dark:text-neutral-300"> ({sign(whatIf.current - real.current)} vs now)</span>}
              {' · '}if the rest were zero <strong>{pct(whatIf.final)}</strong>
            </span>
            <button type="button" onClick={() => setOverrides({})} className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-white dark:border-neutral-700 dark:hover:bg-neutral-900">
              Reset what-ifs
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="py-2 pr-3 font-medium">Assignment</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Due</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">%</th>
                {hasStats && <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">Class median</th>}
                <th className="py-2 pl-3 text-right font-medium">What-if (points)</th>
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
                          {isDropped && <span className="ml-2 rounded-sm bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">dropped</span>}
                          {i.omitted && <span className="ml-2 text-[11px] text-neutral-500">not in final grade</span>}
                        </td>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-neutral-500 dark:text-neutral-400 md:table-cell">{i.dueAt ? formatDay(i.dueAt) : '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${st.className}`}>{st.label}</span>
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
                            aria-label={`What-if score for ${i.name}`}
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
          What-if scores are only for planning: they never leave this page. Totals are calculated the way Canvas does it (group weights and drop rules included).
        </p>
      </Card>
    </div>
  );
}

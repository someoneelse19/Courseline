import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { getLocale, t } from '../i18n';

export interface TrendDatum {
  name: string;
  running: number; // current grade (percent) right after this assignment
  score: number;
  points: number;
  date: string | null;
}

const MIN_H = 240; // the chart's height when its card does not stretch it (phones), and never less
const DAY = 86_400_000;
const M = { top: 16, right: 60, bottom: 28, left: 44 };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' }) : '');
const pct = (n: number) => `${n.toFixed(1)}%`;

/** The element's size, kept current as it changes (the chart is drawn to fill the space its card gives it). */
function useSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 640, h: MIN_H });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = { w: Math.max(280, Math.round(el.clientWidth)), h: Math.max(MIN_H, Math.round(el.clientHeight)) };
      setSize((s) => (s.w === next.w && s.h === next.h ? s : next));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * Running grade over time: each graded assignment at the date it was graded (else its due date), on a real time axis
 * that runs to today, and a 0-100% scale. The grade only changes when something is graded, so the line holds flat
 * between them (steps), not a slope that would suggest grades in between. One series: the card title names it.
 */
export function GradeTrendChart({ data, now = Date.now() }: { data: TrendDatum[]; now?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { w: width, h: H } = useSize(wrap);
  const [active, setActive] = useState<number | null>(null);

  const n = data.length;
  // 0-100%, higher only when extra credit takes the grade past 100.
  const lo = 0;
  const hi = Math.max(100, Math.ceil(Math.max(...data.map((d) => d.running)) / 25) * 25);
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += 25) ticks.push(v);

  // When each point happened. The grading order puts undated work first: it sits at the first dated point. With no
  // dates at all, the points are spaced evenly (by order) instead.
  const parsed = data.map((d) => (d.date ? Date.parse(d.date) : NaN));
  const timed = parsed.some(Number.isFinite);
  const times = timed ? parsed.map((v, i) => (Number.isFinite(v) ? v : parsed.slice(i + 1).find(Number.isFinite)!)) : data.map((_, i) => i);
  const end = timed ? Math.max(times[n - 1], now) : Math.max(1, n - 1);
  const start = timed ? Math.min(times[0], end - DAY) : 0;

  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const xAt = (time: number) => M.left + ((time - start) / (end - start)) * plotW;
  const x = (i: number) => xAt(times[i]);
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const xEnd = M.left + plotW;
  const line = `M${x(0).toFixed(1)} ${y(data[0].running).toFixed(1)}${data
    .slice(1)
    .map((d, k) => ` H${x(k + 1).toFixed(1)} V${y(d.running).toFixed(1)}`)
    .join('')} H${xEnd.toFixed(1)}`;
  const area = `${line} V${y(lo).toFixed(1)} H${x(0).toFixed(1)} Z`;

  // Dates evenly spaced in time (about one per 90 px), each label once.
  const xTicks: Array<{ at: number; label: string }> = [];
  if (timed) {
    const count = Math.max(2, Math.floor(plotW / 90));
    for (let k = 0; k < count; k++) {
      const at = start + (k * (end - start)) / (count - 1);
      const label = fmtDate(new Date(at).toISOString());
      if (label !== xTicks.at(-1)?.label) xTicks.push({ at, label });
    }
  } else {
    data.forEach((_, i) => xTicks.push({ at: i, label: `#${i + 1}` }));
  }
  const last = data[n - 1];
  const a = active != null ? data[active] : null;

  // The point closest to the pointer along the time axis.
  const nearest = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = M.left + ((e.clientX - box.left) / box.width) * plotW;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    return best;
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const move = (to: number) => (e.preventDefault(), setActive(Math.min(n - 1, Math.max(0, to))));
    if (e.key === 'ArrowRight') move((active ?? -1) + 1);
    else if (e.key === 'ArrowLeft') move((active ?? n) - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(n - 1);
    else if (e.key === 'Escape') setActive(null);
  };

  const tipLeft = a ? Math.min(Math.max(x(active!) + 12, 8), width - 190) : 0;
  const tipRight = a && x(active!) + 12 > width - 190;

  return (
    // Fills its card (the card stretches to the tiles beside it). The drawing is absolutely placed, so its own height
    // never feeds back into the size it is measured from.
    <div className="flex min-h-60 flex-1 flex-col">
        <div ref={wrap} className="relative min-h-60 flex-1">
          <svg
            width={width}
            height={H}
            role="img"
            tabIndex={0}
            aria-label={t('Running grade over {n} graded assignments, from {from} to {to}. Use the arrow keys to step through points.', { n, from: pct(data[0].running), to: pct(last.running) })}
            onKeyDown={onKey}
            onFocus={() => active == null && setActive(n - 1)}
            onBlur={() => setActive(null)}
            className="absolute inset-0 block rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} strokeWidth={1} shapeRendering="crispEdges" className="stroke-neutral-200 dark:stroke-neutral-800" />
                <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-neutral-500 text-[11px] tabular-nums dark:fill-neutral-400">
                  {v}%
                </text>
              </g>
            ))}
            {xTicks.map((tick, k) => (
              <text key={k} x={xAt(tick.at)} y={H - 8} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'} className="fill-neutral-500 text-[11px] dark:fill-neutral-400">
                {tick.label}
              </text>
            ))}

            <path d={area} style={{ fill: 'rgb(var(--accent-600) / 0.1)' }} />
            <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'rgb(var(--accent-600))' }} />

            {a && <line x1={x(active!)} x2={x(active!)} y1={M.top} y2={M.top + plotH} strokeWidth={1} shapeRendering="crispEdges" className="stroke-neutral-400 dark:stroke-neutral-600" />}
            {a && <circle cx={x(active!)} cy={y(a.running)} r={5} strokeWidth={2} className="stroke-white dark:stroke-neutral-900" style={{ fill: 'rgb(var(--accent-600))' }} />}
            <circle cx={x(n - 1)} cy={y(last.running)} r={4.5} strokeWidth={2} className="stroke-white dark:stroke-neutral-900" style={{ fill: 'rgb(var(--accent-600))' }} />
            <text x={xEnd + 8} y={y(last.running)} dy="0.32em" className="fill-neutral-900 text-xs font-semibold tabular-nums dark:fill-neutral-100">
              {pct(last.running)}
            </text>

            {/* Hit layer spans the whole plot: the pointer only has to be near a point's x, not on it. */}
            <rect
              x={M.left}
              y={M.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              onPointerMove={(e) => setActive(nearest(e))}
              onPointerDown={(e) => setActive(nearest(e))}
              onPointerLeave={() => setActive(null)}
            />
          </svg>

          {a && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 z-10 w-44 rounded-lg border border-neutral-200 bg-white p-2.5 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
              style={tipRight ? { left: x(active!) - 12 - 176 } : { left: tipLeft }}
            >
              <p className="text-base font-semibold tabular-nums">{pct(a.running)}</p>
              <p className="mt-0.5 truncate text-neutral-600 dark:text-neutral-300">{a.name}</p>
              <p className="text-neutral-500 dark:text-neutral-400">
                {a.score} / {a.points}
                {a.points > 0 ? ` (${((a.score / a.points) * 100).toFixed(0)}%)` : ''}
                {a.date ? ` · ${fmtDate(a.date)}` : ''}
              </p>
            </div>
          )}
        </div>
      {/* The same data for screen readers. */}
      <table className="sr-only">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('Assignment')}</th>
            <th>{t('Score')}</th>
            <th>{t('Date')}</th>
            <th>{t('Grade after')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{d.name}</td>
              <td>
                {d.score} / {d.points}
              </td>
              <td>{fmtDate(d.date)}</td>
              <td>{pct(d.running)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

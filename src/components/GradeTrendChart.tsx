import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface TrendDatum {
  name: string;
  running: number; // current grade (percent) right after this assignment
  score: number;
  points: number;
  date: string | null;
}

const H = 240;
const M = { top: 16, right: 60, bottom: 28, left: 44 };
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '');
const pct = (n: number) => `${n.toFixed(1)}%`;

function useWidth(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(280, Math.round(el.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Running grade, one point per graded assignment (in grading order). One series: the card title names it. */
export function GradeTrendChart({ data }: { data: TrendDatum[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const n = data.length;
  const runs = data.map((d) => d.running);
  let hi = Math.max(Math.min(100, Math.ceil((Math.max(...runs) + 5) / 10) * 10), Math.ceil(Math.max(...runs) / 10) * 10);
  let lo = Math.max(0, Math.floor((Math.min(...runs) - 5) / 10) * 10);
  if (hi - lo < 20) lo = Math.max(0, hi - 20);
  if (hi - lo < 20) hi = lo + 20;
  const step = hi - lo <= 30 ? 10 : hi - lo <= 60 ? 20 : 25;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);

  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v: number) => M.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d.running).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${y(lo).toFixed(1)} L${x(0).toFixed(1)} ${y(lo).toFixed(1)} Z`;

  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));
  const last = data[n - 1];
  const a = active != null ? data[active] : null;

  const nearest = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    return n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round((px / box.width) * (n - 1))));
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
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {table ? 'Chart view' : 'Table view'}
        </button>
      </div>

      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-50 text-left text-xs text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Assignment</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Grade after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {data.map((d, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5 tabular-nums text-neutral-500">{i + 1}</td>
                  <td className="px-3 py-1.5">{d.name}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {d.score} / {d.points}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-500">{fmtDate(d.date)}</td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">{pct(d.running)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative">
          <svg
            width={width}
            height={H}
            role="img"
            tabIndex={0}
            aria-label={`Running grade over ${n} graded assignments, from ${pct(data[0].running)} to ${pct(last.running)}. Use the arrow keys to step through points, or switch to table view.`}
            onKeyDown={onKey}
            onFocus={() => active == null && setActive(n - 1)}
            onBlur={() => setActive(null)}
            className="block rounded-md outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} strokeWidth={1} shapeRendering="crispEdges" className="stroke-neutral-200 dark:stroke-neutral-800" />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-neutral-500 text-[11px] tabular-nums dark:fill-neutral-400">
                  {t}%
                </text>
              </g>
            ))}
            {data.map((d, i) =>
              i % labelEvery === 0 || i === n - 1 ? (
                <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-neutral-500 text-[11px] dark:fill-neutral-400">
                  {fmtDate(d.date) || `#${i + 1}`}
                </text>
              ) : null,
            )}

            {n > 1 && <path d={area} style={{ fill: 'rgb(var(--accent-600) / 0.1)' }} />}
            {n > 1 && <path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: 'rgb(var(--accent-600))' }} />}

            {a && <line x1={x(active!)} x2={x(active!)} y1={M.top} y2={M.top + plotH} strokeWidth={1} shapeRendering="crispEdges" className="stroke-neutral-400 dark:stroke-neutral-600" />}
            {a && <circle cx={x(active!)} cy={y(a.running)} r={5} strokeWidth={2} className="stroke-white dark:stroke-neutral-900" style={{ fill: 'rgb(var(--accent-600))' }} />}
            <circle cx={x(n - 1)} cy={y(last.running)} r={4.5} strokeWidth={2} className="stroke-white dark:stroke-neutral-900" style={{ fill: 'rgb(var(--accent-600))' }} />
            <text x={x(n - 1) + 12} y={y(last.running)} dy="0.32em" className="fill-neutral-900 text-xs font-semibold tabular-nums dark:fill-neutral-100">
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
      )}
    </div>
  );
}

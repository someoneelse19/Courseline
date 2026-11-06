// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { GradeTrendChart, type TrendDatum } from './GradeTrendChart';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function render(data: TrendDatum[], now: number) {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<GradeTrendChart data={data} now={now} />));
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el;
}

const day = (d: number) => Date.UTC(2026, 9, 1 + d, 12);
const point = (d: number | null, running: number): TrendDatum => ({ name: `A${d}`, running, score: 1, points: 1, date: d === null ? null : new Date(day(d)).toISOString() });
// The x positions the line moves to (its H commands), in order.
const steps = (el: HTMLElement) => {
  const d = el.querySelectorAll('path')[1].getAttribute('d') ?? '';
  return { startX: Number(/^M([\d.]+)/.exec(d)?.[1]), xs: [...d.matchAll(/H([\d.]+)/g)].map((m) => Number(m[1])) };
};

describe('GradeTrendChart', () => {
  it('places each grade at its date on a time axis that runs to today', async () => {
    const el = await render([point(0, 80), point(1, 70), point(10, 75)], day(20));
    const { startX, xs } = steps(el);
    const [second, third, today] = xs;
    // Day 1 is a tenth of the way to day 10, and day 10 halfway to today (day 20): spaced by time, not one per grade.
    expect((second - startX) / (third - startX)).toBeCloseTo(0.1, 2);
    expect((third - startX) / (today - startX)).toBeCloseTo(0.5, 2);
  });

  it('always shows 0 to 100%', async () => {
    const el = await render([point(0, 92), point(3, 95)], day(5));
    const labels = [...el.querySelectorAll('text')].map((x) => x.textContent).filter((x) => /^\d+%$/.test(x ?? ''));
    expect(labels).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });

  it('puts work graded without any date at the first dated grade', async () => {
    const el = await render([point(null, 50), point(4, 60), point(8, 70)], day(8));
    const { startX, xs } = steps(el);
    expect(xs[0]).toBeCloseTo(startX); // the undated one and day 4 share a spot
    expect((xs[1] - startX) / (xs[2] - startX)).toBeCloseTo(1, 2); // day 8 is today: the line ends there
  });
});

import { describe, expect, it } from 'vitest';
import { cleanSteps, runPull } from './pullRunner.js';

const steps = [1, 2, 3].map((n) => ({ url: `https://h/u${n}`, label: `p${n}` }));
const base = { pause: async () => {}, isCancelled: () => false };

describe('runPull', () => {
  it('visits every page in order, pausing between but not after the last', async () => {
    const order = [];
    let pauses = 0;
    const out = await runPull({ ...base, steps, pause: async () => void pauses++, visit: async (s) => (order.push(s.label), { captured: 2 }) });
    expect(order).toEqual(['p1', 'p2', 'p3']);
    expect(pauses).toBe(2);
    expect(out.cancelled).toBe(false);
    expect(out.results.every((r) => r.captured === 2)).toBe(true);
  });

  it('stops before the next page once cancelled', async () => {
    let cancelled = false;
    const visited = [];
    const out = await runPull({
      ...base,
      steps,
      isCancelled: () => cancelled,
      visit: async (s) => {
        visited.push(s.label);
        if (s.label === 'p2') cancelled = true;
        return { captured: 1 };
      },
    });
    expect(visited).toEqual(['p1', 'p2']);
    expect(out.cancelled).toBe(true);
  });

  it('records a failed page and carries on', async () => {
    const out = await runPull({ ...base, steps, visit: async (s) => { if (s.label === 'p2') throw new Error('timed out'); return { captured: 1 }; } });
    expect(out.results.map((r) => r.error ?? null)).toEqual([null, 'timed out', null]);
  });

  it('reports progress for every page', async () => {
    const seen = [];
    await runPull({ ...base, steps, visit: async () => ({}), onProgress: (p) => seen.push(`${p.index}:${p.state}`) });
    expect(seen).toEqual(['0:visiting', '0:done', '1:visiting', '1:done', '2:visiting', '2:done']);
  });
});

describe('runPull with several tabs at once', () => {
  it('keeps up to `concurrency` pages loading, never more, and returns results in list order', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `https://h/${i}`, label: String(i) }));
    let open = 0;
    let peak = 0;
    const out = await runPull({
      ...base,
      steps: many,
      concurrency: 4,
      visit: async (s) => {
        open++;
        peak = Math.max(peak, open);
        await new Promise((r) => setTimeout(r, 5 + (Number(s.label) % 3) * 5));
        open--;
        return { captured: Number(s.label) };
      },
    });
    expect(peak).toBe(4);
    expect(out.results.map((r) => r.captured)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out.cancelled).toBe(false);
  });

  it('starts no new page once cancelled, and lets the ones loading finish', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ url: `https://h/${i}`, label: String(i) }));
    let cancelled = false;
    const started = [];
    const out = await runPull({
      ...base,
      steps: many,
      concurrency: 3,
      isCancelled: () => cancelled,
      visit: async (s) => {
        started.push(s.label);
        if (s.label === '1') cancelled = true;
        await new Promise((r) => setTimeout(r, 5));
        return {};
      },
    });
    expect(out.cancelled).toBe(true);
    expect(started).toEqual(['0', '1']); // the third worker saw the cancel before taking a page
    expect(out.results).toHaveLength(2);
  });
});

describe('cleanSteps', () => {
  it('keeps https steps with a label, drops the rest, and does not cap the count', () => {
    const out = cleanSteps([{ url: 'https://h/a', label: 'A' }, { url: 'http://h/b' }, { url: 'javascript:1' }, { label: 'no url' }, 'x', { url: 'https://h/c' }]);
    expect(out).toEqual([{ url: 'https://h/a', label: 'A' }, { url: 'https://h/c', label: 'https://h/c' }]);
    const many = Array.from({ length: 900 }, (_, i) => ({ url: `https://h/${i}`, label: String(i) }));
    expect(cleanSteps(many)).toHaveLength(900);
    expect(cleanSteps('nope')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { cleanSteps, MAX_STEPS, runPull, withinHourlyCap } from './pullRunner.js';

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

describe('cleanSteps', () => {
  it('keeps https steps with a label, drops the rest, and caps the count', () => {
    const out = cleanSteps([{ url: 'https://h/a', label: 'A' }, { url: 'http://h/b' }, { url: 'javascript:1' }, { label: 'no url' }, 'x', { url: 'https://h/c' }]);
    expect(out).toEqual([{ url: 'https://h/a', label: 'A' }, { url: 'https://h/c', label: 'https://h/c' }]);
    const many = Array.from({ length: 200 }, (_, i) => ({ url: `https://h/${i}`, label: String(i) }));
    expect(cleanSteps(many)).toHaveLength(MAX_STEPS);
    expect(cleanSteps('nope')).toEqual([]);
  });
});

describe('withinHourlyCap', () => {
  const now = 10_000_000;
  it('allows pages while under the cap and drops opens older than an hour', () => {
    expect(withinHourlyCap([now - 7_200_000, now - 60_000], now)).toEqual([now - 60_000]);
  });

  it('refuses once the cap is reached', () => {
    const full = Array.from({ length: 300 }, (_, i) => now - i * 1000);
    expect(withinHourlyCap(full, now)).toBeNull();
    expect(withinHourlyCap(full.slice(1), now)).toHaveLength(299);
  });
});

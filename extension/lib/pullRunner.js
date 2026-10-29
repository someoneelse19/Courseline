// Pure: visits a list of pages, `concurrency` at a time (the owner's choice: several background tabs at once; the
// design doc's one-at-a-time is concurrency 1). The caller supplies what "visit" means (open it in a background tab),
// the pause between pages, and a cancel check. Kept from the design doc: a pause between pages, cancellable before and
// after every page, and a failed page is recorded and the run goes on.

// A page is done when it reports it has gone quiet (see inject.js), not after a fixed time, because load times differ a
// lot. These bound that wait.
export const IDLE_MAX_MS = 12000; // give up waiting for "quiet" this long after the page's load event
export const MIN_SETTLE_MS = 250; // after "quiet", a moment for the last captures to reach the background script
export const PAUSE_MS = 400; // between pages, so the next one does not start in the same instant
export const CONCURRENCY = 4; // background tabs loading at the same time

/**
 * `visit(step)` loads a page and resolves { captured, items?, loaded? }; a thrown error is recorded and the run
 * continues. `isCancelled()` is checked before and after every page.
 */
export async function runPull({ steps, visit, pause, isCancelled, onProgress = () => {}, concurrency = 1 }) {
  const results = new Array(steps.length);
  let next = 0;
  let cancelled = false;
  // Each worker takes the next page in the list until none is left; results keep the list's order.
  const worker = async () => {
    while (next < steps.length) {
      if (isCancelled()) return void (cancelled = true);
      const i = next++;
      onProgress({ index: i, total: steps.length, step: steps[i], state: 'visiting' });
      let outcome;
      try {
        outcome = { captured: 0, ...(await visit(steps[i])) };
      } catch (e) {
        outcome = { captured: 0, error: String(e?.message ?? e) };
      }
      results[i] = { step: steps[i], ...outcome };
      onProgress({ index: i, total: steps.length, step: steps[i], state: 'done', outcome });
      if (isCancelled()) return void (cancelled = true);
      if (next < steps.length) await pause();
    }
  };
  const width = Math.max(1, Math.min(Math.floor(concurrency) || 1, steps.length));
  await Promise.all(Array.from({ length: width }, worker));
  return { cancelled, results: results.filter(Boolean) };
}

/** Keeps only well-formed steps ({ url, label } strings, https). There is no limit on how many (the owner's choice). */
export function cleanSteps(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const s of input) {
    if (typeof s?.url !== 'string') continue;
    try {
      if (new URL(s.url).protocol !== 'https:') continue;
    } catch {
      continue;
    }
    out.push({ url: s.url, label: typeof s.label === 'string' ? s.label.slice(0, 120) : s.url });
  }
  return out;
}

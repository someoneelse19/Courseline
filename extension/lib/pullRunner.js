// Pure: visits a list of pages one at a time. The caller supplies what "visit" means (open it in a background tab),
// the pause between pages, and a cancel check. Rules from the design doc kept here: one page at a time, a pause
// between pages, cancellable before and after every page, and a failed page is recorded and the run goes on.

// A page is done when it reports it has gone quiet (see inject.js), not after a fixed time, because load times differ a
// lot. These bound that wait.
export const IDLE_MAX_MS = 12000; // give up waiting for "quiet" this long after the page's load event
export const MIN_SETTLE_MS = 250; // after "quiet", a moment for the last captures to reach the background script
export const PAUSE_MS = 400; // between pages, so the next one does not start in the same instant
export const MAX_STEPS = 200; // one run never opens more pages than this

/**
 * `visit(step)` loads a page and resolves { captured, items?, loaded? }; a thrown error is recorded and the run
 * continues. `isCancelled()` is checked before and after every page.
 */
export async function runPull({ steps, visit, pause, isCancelled, onProgress = () => {} }) {
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    if (isCancelled()) return { cancelled: true, results };
    onProgress({ index: i, total: steps.length, step: steps[i], state: 'visiting' });
    let outcome;
    try {
      outcome = { captured: 0, ...(await visit(steps[i])) };
    } catch (e) {
      outcome = { captured: 0, error: String(e?.message ?? e) };
    }
    results.push({ step: steps[i], ...outcome });
    onProgress({ index: i, total: steps.length, step: steps[i], state: 'done', outcome });
    if (isCancelled()) return { cancelled: true, results };
    if (i < steps.length - 1) await pause();
  }
  return { cancelled: false, results };
}

export const MAX_PAGES_PER_HOUR = 300; // across every run, so no sequence of runs can hammer Canvas

/**
 * Pages opened in the last hour, given every open's timestamp (oldest first). Returns the timestamps still inside the
 * hour, or null when one more page would go over the cap.
 */
export function withinHourlyCap(timestamps, now, max = MAX_PAGES_PER_HOUR) {
  const live = timestamps.filter((at) => now - at <= 3600e3);
  return live.length >= max ? null : live;
}

/** Keeps only well-formed steps ({ url, label } strings, https), and no more than MAX_STEPS. */
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
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

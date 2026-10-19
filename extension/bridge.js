// Lets the Courseline web app (running on localhost) read what this extension has captured. It runs only on
// localhost pages, answers only the Courseline app, and never starts a Canvas request.
//
//   app  -> { source: 'courseline-app', id, type: 'hello' | 'snapshot' | 'setPinned' | 'setCanvasHost' | 'pull' |
//             'cancelPull', ids?, input?, steps?, continueFrom? }
//   here -> { source: 'courseline-extension', id, ...reply }, { type: 'changed' } when data is saved, and while a
//           pull runs { type: 'pullProgress', ... } per page and { type: 'pullDone', ... } at the end
//
// "Only the Courseline app" means: a port the app is served on, and the page declares itself with
// <meta name="courseline-app">. Another project on localhost has neither, so it gets no answer.
const APP = 'courseline-app';
const EXT = 'courseline-extension';
const version = chrome.runtime.getManifest().version;
const ALLOWED_PORTS = new Set(['5173', '5174', '5175', '5176', '5177', '5178', '5179', '5180', '4173']);

const portOk = ALLOWED_PORTS.has(location.port);
const isCourseline = () => !!document.querySelector('meta[name="courseline-app"]');

// The marker the app checks synchronously. Set as soon as the page's <meta> is parsed (before the app's scripts run).
function markIfCourseline() {
  if (portOk && isCourseline()) {
    document.documentElement.dataset.courselineExtension = version;
    return true;
  }
  return false;
}
if (portOk && !markIfCourseline()) {
  const observer = new MutationObserver(() => markIfCourseline() && observer.disconnect());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => observer.disconnect(), { once: true });
}

if (portOk) chrome.storage.local.set({ appOrigin: location.origin }).catch(() => {});

const post = (message) => window.postMessage({ source: EXT, ...message }, location.origin);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The pull the student confirmed inside the app. The loop lives here, in the app's own tab, so it stops when that
// tab closes, and the confirmation, the preview and Stop are all in the app. Pages are opened one at a time by the
// background script, in a background tab.
let pull = null;
// The run that just finished, so the app can continue a confirmed plan (it opens the dashboard first, then the
// courses it brought in) without a second click.
let lastRun = null;
const CONTINUE_WITHIN_MS = 2 * 60 * 1000;

async function startPull(m) {
  if (pull) return post({ id: m.id, ok: false, busy: true });
  // A run needs a real click on the page, or to be the one continuation of a run a click just started (the app opens
  // the dashboard first, then the courses it brought in). A script on the page cannot start one by itself.
  const clicked = !!navigator.userActivation?.isActive;
  const continues = typeof m.continueFrom === 'string' && lastRun && lastRun.id === m.continueFrom && !lastRun.cancelled && Date.now() - lastRun.endedAt < CONTINUE_WITHIN_MS;
  if (!clicked && !continues) {
    return post({ id: m.id, ok: false, error: 'A sync only starts from a click in Courseline.' });
  }
  // Claim the slot before anything is awaited, so a second message that arrives meanwhile (a double click) is turned away.
  pull = { cancelled: false };
  // A continuation is used up, and a run that was itself a continuation cannot be continued: chaining needs a click.
  if (continues) lastRun = null;
  try {
    const { runPull, cleanSteps, PAUSE_MS } = await import(chrome.runtime.getURL('lib/pullRunner.js'));
    const steps = cleanSteps(m.steps);
    if (!steps.length) return post({ id: m.id, ok: false, error: 'There was nothing to open.' });
    post({ id: m.id, ok: true, runId: m.id, total: steps.length });
    const out = await runPull({
      steps,
      isCancelled: () => pull.cancelled,
      pause: () => sleep(PAUSE_MS),
      visit: async (step) => {
        const r = await chrome.runtime.sendMessage({ type: 'openPage', url: step.url });
        if (!r?.ok) throw new Error(r?.error ?? 'The extension did not answer.');
        return r;
      },
      onProgress: (p) => post({ type: 'pullProgress', runId: m.id, ...p }),
    });
    if (!continues) lastRun = { id: m.id, endedAt: Date.now(), cancelled: out.cancelled };
    post({ type: 'pullDone', runId: m.id, cancelled: out.cancelled, results: out.results });
  } catch (e) {
    post({ type: 'pullDone', runId: m.id, cancelled: false, results: [], error: String(e?.message ?? e) });
  } finally {
    pull = null;
  }
}

window.addEventListener('message', async (event) => {
  if (!portOk || !isCourseline()) return;
  if (event.source !== window || event.origin !== location.origin) return;
  const m = event.data;
  if (!m || m.source !== APP || typeof m.id !== 'string') return;
  try {
    if (m.type === 'hello') {
      post({ id: m.id, version });
    } else if (m.type === 'snapshot') {
      const all = await chrome.storage.local.get(null);
      const records = Object.entries(all)
        .filter(([key]) => key.startsWith('cap:'))
        .map(([, record]) => record);
      post({ id: m.id, records, health: all.health ?? {}, appPinned: all.appPinned ?? null, canvasHost: all.canvasHost ?? null, visited: all.visited ?? {}, takenAt: Date.now() });
    } else if (m.type === 'pull') {
      void startPull(m);
    } else if (m.type === 'cancelPull') {
      if (pull) pull.cancelled = true;
      chrome.runtime.sendMessage({ type: 'cancelPull' }).catch(() => {});
      post({ id: m.id, ok: true });
    } else if (m.type === 'setCanvasHost') {
      const result = await chrome.runtime.sendMessage({ type: 'setCanvasHost', input: typeof m.input === 'string' ? m.input : '' });
      post({ id: m.id, ...(result ?? { ok: false, error: 'The extension did not answer.' }) });
    } else if (m.type === 'setPinned') {
      await chrome.runtime.sendMessage({ type: 'setPinned', ids: m.ids ?? null });
      post({ id: m.id, ok: true });
    }
  } catch {
    // Extension reloaded under an open page: the app's request just times out.
  }
});

// The popup's "Sync in Courseline" button asks an app tab that is already open to show its plan (no reload).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'openPlan' && portOk && isCourseline()) post({ type: 'openPlan' });
});

let timer;
chrome.storage.onChanged.addListener(() => {
  clearTimeout(timer);
  timer = setTimeout(() => isCourseline() && post({ type: 'changed' }), 300);
});

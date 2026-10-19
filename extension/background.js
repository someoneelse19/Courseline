import { applyCanvasAddress } from './lib/canvasAddress.js';
import { classify, cleanPinnedIds, expiredKeys, keepCourse, sameOrigin, stripSensitive } from './lib/capture.js';
import { peekSample } from './lib/peek.js';
import { IDLE_MAX_MS, MIN_SETTLE_MS, withinHourlyCap } from './lib/pullRunner.js';
import { effectivePinnedIds } from './lib/pinned.js';
import { readDashboardCards } from './lib/readers.js';
import { skeleton } from './lib/shape.js';

// Everything captured lives in chrome.storage.local on this machine. Nothing is sent anywhere by this extension.
// Layout: `cap:<key>` -> { kind, courseId, host, url, capturedAt, body }; `health` -> per-kind counters;
// `canvasHost` -> the one host captures are accepted from; `pinned` -> course ids on the Canvas dashboard;
// `appPinned` -> course ids the student chose in the Courseline app (see bridge.js).

let queue = Promise.resolve(); // serializes the read-modify-write on `health`
let pageQueue = Promise.resolve(); // one background page at a time
const idleWaiters = new Map(); // tab id -> resolve, called when that tab's page reports it has gone quiet
const removedWaiters = new Map(); // tab id -> resolve, called when that tab is closed (by Stop, or by the student)
const recent = []; // what was just saved: { at, label, sample }, for the preview in the app
const MAX_RECENT = 400;
const PRUNE_EVERY_MS = 3600e3;
const MAX_RECORD_CHARS = 3_000_000; // one saved response; bigger ones are counted, not kept
const MAX_RECORDS = 6000; // the oldest go first beyond this

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab) return;
  if (msg?.type === 'setCanvasHost') {
    // From the bridge: the Canvas address typed into the Courseline app. Same rules as the popup's field.
    applyCanvasAddress(chrome.storage.local, msg.input).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not save the address.' }));
    return true; // keep the channel open for the reply
  }
  if (msg?.type === 'openPage') {
    // From the bridge, for a run the student confirmed inside the Courseline app: load one Canvas page in a
    // background tab, wait for it, close it, and say what it brought in. One page at a time.
    pageQueue = pageQueue.then(() => openPage(msg.url, sender)).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  if (msg?.type === 'pageIdle') {
    idleWaiters.get(sender.tab.id)?.();
    return;
  }
  if (msg?.type === 'cancelPull') {
    closePullTabs();
    return;
  }
  if (msg?.type === 'setPinned') {
    // From the bridge: the courses the student chose in the app. null/empty goes back to the Canvas dashboard.
    const ids = msg.ids === null ? [] : cleanPinnedIds(msg.ids);
    if (ids === null) return;
    queue = queue.then(() => (ids.length ? chrome.storage.local.set({ appPinned: ids }) : chrome.storage.local.remove('appPinned'))).catch(() => {});
    return;
  }
  if (msg?.type !== 'capture') return;
  queue = queue.then(() => save(msg.url, msg.body, msg.operation, msg.variables, sender.url)).catch(() => {});
});

async function save(url, body, operation, variables, senderUrl) {
  // A page can only speak for its own origin: a response claiming another origin's URL is dropped.
  if (!sameOrigin(url, senderUrl)) return;
  const info = classify(url, body, operation, variables);
  if (!info) return;
  const now = Date.now();
  const host = new URL(url).host;
  const store = await chrome.storage.local.get(['canvasHost', 'pinned', 'appPinned', 'health', 'skippedLarge']);

  // Only the Canvas address the student saved is believed. The "is this Canvas?" check runs inside the page, where
  // any website can fake it, so nothing here ever picks the host for them: without a saved address, nothing is kept.
  if (!store.canvasHost || store.canvasHost !== host) return;

  if (info.kind === null) {
    // An API address Courseline has no reader for yet. Everything a page reads is kept, so it is saved in full as
    // kind "other"; the address shape and a count are also noted so the popup and the app can list what was seen.
    if (!keepCourse(info.courseId, effectivePinnedIds({ pinned: store.pinned, appPinned: store.appPinned }))) return;
    const record = { kind: 'other', route: info.unmapped, courseId: info.courseId, host: info.host, url, capturedAt: now, body: stripSensitive(body) };
    if (JSON.stringify(record).length > MAX_RECORD_CHARS) {
      await chrome.storage.local.set({ skippedLarge: (store.skippedLarge ?? 0) + 1 });
      return;
    }
    await chrome.storage.local.set({ [`cap:${info.key}`]: record });
    noteRecent(info.unmapped, record.body);
    const { unmapped = {}, shapes = {} } = await chrome.storage.local.get(['unmapped', 'shapes']);
    const u = (unmapped[info.unmapped] ??= { count: 0, lastAt: 0 });
    u.count += 1;
    u.lastAt = now;
    // The first response of each kind also leaves its structure (field names and types, no values), so a reader can
    // be written for it later.
    if (!shapes[info.unmapped] && Object.keys(shapes).length < 100) shapes[info.unmapped] = skeleton(body);
    if (Object.keys(unmapped).length <= 300) await chrome.storage.local.set({ unmapped, shapes });
    return;
  }

  const health = store.health ?? {};
  // The dashboard is the fallback list of pinned courses; remember it. Keep nothing about any course that is not pinned.
  if (info.kind === 'dashboardCards' && info.shapeOk) {
    const ids = (readDashboardCards(body) ?? []).map((c) => c.id);
    if (ids.length) await chrome.storage.local.set({ pinned: ids });
  } else if (!keepCourse(info.courseId, effectivePinnedIds({ pinned: store.pinned, appPinned: store.appPinned }))) {
    return;
  }

  const h = (health[info.kind] ??= { ok: 0, badShape: 0, lastOkAt: null, lastBadAt: null });
  if (info.shapeOk) {
    h.ok += 1;
    h.lastOkAt = now;
    const record = { kind: info.kind, courseId: info.courseId, host: info.host, url, capturedAt: now, body: stripSensitive(body) };
    await chrome.storage.local.set({ [`cap:${info.key}`]: record, health });
    noteRecent(info.kind, body);
  } else {
    // Known route, unexpected shape: do not store it as data, but remember that it happened, and keep its structure
    // (names and types, no values) once so we can see what Canvas sent instead.
    h.badShape += 1;
    h.lastBadAt = now;
    const { shapes = {} } = await chrome.storage.local.get('shapes');
    const label = `REJECTED ${info.kind}`;
    if (!shapes[label] && Object.keys(shapes).length < 100) shapes[label] = skeleton(body);
    await chrome.storage.local.set({ health, shapes });
  }
  await pruneOld(now);
}

// Saved responses do not live forever: anything older than 90 days is deleted, checked at most once an hour.
async function pruneOld(now) {
  const { lastPrune = 0 } = await chrome.storage.local.get('lastPrune');
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  const all = await chrome.storage.local.get(null);
  const old = expiredKeys(all, now);
  // Keep the newest MAX_RECORDS: everything is saved now, so there is a ceiling.
  const live = Object.entries(all).filter(([k]) => k.startsWith('cap:') && !old.includes(k));
  if (live.length > MAX_RECORDS) {
    live.sort(([, a], [, b]) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
    old.push(...live.slice(0, live.length - MAX_RECORDS).map(([k]) => k));
  }
  if (old.length) await chrome.storage.local.remove(old);
  await chrome.storage.local.set({ lastPrune: now });
}

function noteRecent(label, body) {
  recent.push({ at: Date.now(), label, sample: peekSample(body) });
  if (recent.length > MAX_RECENT) recent.shift();
}

// Pull state that must outlive this worker: Chrome shuts it down when idle, which would otherwise reset the hourly
// cap and forget which tabs Stop should close. Session storage survives that and clears when the browser closes.
async function session(key, fallback) {
  try {
    return (await chrome.storage.session.get(key))[key] ?? fallback;
  } catch {
    return fallback;
  }
}
const setSession = (obj) => chrome.storage.session.set(obj).catch(() => {});

async function closePullTabs() {
  const ids = await session('pullTabs', []);
  await setSession({ pullTabs: [] });
  for (const id of ids) chrome.tabs.remove(id).catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tab closed from outside (Stop, or the student) must end the wait for it at once, not after the timeouts.
chrome.tabs.onRemoved.addListener((id) => removedWaiters.get(id)?.());

// Resolves true when the tab finishes loading, false after the timeout.
function waitForLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const finish = (v) => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(v);
    };
    const listener = (id, info) => id === tabId && info.status === 'complete' && finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    // It may have finished before the listener was attached.
    chrome.tabs.get(tabId).then((t) => t?.status === 'complete' && finish(true), () => {});
  });
}

async function openPage(url, sender) {
  const { canvasHost } = await chrome.storage.local.get('canvasHost');
  let target;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, error: 'That is not a valid address.' };
  }
  // Only the student's own Canvas, and only https.
  if (target.protocol !== 'https:' || !canvasHost || target.host !== canvasHost) {
    return { ok: false, error: 'That page is not on your Canvas address.' };
  }
  const startedAt = Date.now();
  const live = withinHourlyCap(await session('opened', []), startedAt);
  if (!live) return { ok: false, error: 'That is a lot of pages for one hour. Wait a while and try again.' };
  await setSession({ opened: [...live, startedAt] });
  // In the background of the window the student is already in: no new window, no focus change.
  const tab = await chrome.tabs.create({ url: target.href, active: false, windowId: sender.tab?.windowId });
  await setSession({ pullTabs: [...(await session('pullTabs', [])), tab.id] });
  // Registered before waiting for the load, so a "quiet" signal that comes early is not missed.
  const quiet = new Promise((resolve) => idleWaiters.set(tab.id, resolve));
  let removed = false;
  const gone = new Promise((resolve) => removedWaiters.set(tab.id, resolve));
  gone.then(() => (removed = true));
  const loaded = await Promise.race([waitForLoad(tab.id), gone.then(() => false)]);
  // Move on as soon as the page reports it has gone quiet; a page that never says so is cut off at IDLE_MAX_MS.
  if (!removed) await Promise.race([quiet, gone, sleep(IDLE_MAX_MS)]);
  idleWaiters.delete(tab.id);
  removedWaiters.delete(tab.id);
  if (!removed) {
    await sleep(MIN_SETTLE_MS);
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
  await setSession({ pullTabs: (await session('pullTabs', [])).filter((id) => id !== tab.id) });
  await queue; // let the captures from this page finish saving

  // Remember it was opened, so a later "pull linked pages" skips it, but only if it really loaded: a page that timed
  // out, or that Stop closed, is worth trying again. Newest 3,000 kept.
  if (loaded && !removed) {
    const { visited = {} } = await chrome.storage.local.get('visited');
    visited[target.href.split('#')[0]] = Date.now();
    const entries = Object.entries(visited);
    if (entries.length > 3000) {
      entries.sort(([, a], [, b]) => b - a);
      await chrome.storage.local.set({ visited: Object.fromEntries(entries.slice(0, 3000)) });
    } else {
      await chrome.storage.local.set({ visited });
    }
  }

  const byLabel = new Map();
  for (const r of recent.filter((x) => x.at >= startedAt)) {
    const e = byLabel.get(r.label) ?? { label: r.label, count: 0, sample: [] };
    e.count += 1;
    for (const name of r.sample) if (e.sample.length < 3 && !e.sample.includes(name)) e.sample.push(name);
    byLabel.set(r.label, e);
  }
  const items = [...byLabel.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  return { ok: true, loaded, stopped: removed, captured: items.reduce((n, i) => n + i.count, 0), items };
}

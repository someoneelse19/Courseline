import { applyCanvasAddress } from './lib/canvasAddress.js';
import { cleanSendRequest, sendRequestFor } from './lib/message.js';
import { classify, classifyPage, cleanPinnedIds, expiredKeys, keepCourse, sameOrigin, stripSensitive } from './lib/capture.js';
import { peekSample } from './lib/peek.js';
import { IDLE_MAX_MS, MIN_SETTLE_MS } from './lib/pullRunner.js';
import { effectivePinnedIds } from './lib/pinned.js';
import { readDashboardCards } from './lib/readers.js';
import { skeleton } from './lib/shape.js';

// Everything captured lives in chrome.storage.local on this machine. Nothing is sent anywhere by this extension.
// Layout: `cap:<key>` -> { kind, courseId, host, url, capturedAt, body }; `health` -> per-kind counters;
// `canvasHost` -> the one host captures are accepted from; `pinned` -> course ids on the Canvas dashboard;
// `appPinned` -> course ids the student chose in the Courseline app (see bridge.js).

let queue = Promise.resolve(); // serializes the read-modify-write on `health`
const openTabs = new Set(); // background tabs a pull has open right now (also kept in session storage, for Stop)
// Tabs a pull opened before Chrome restarted this worker: loaded once, before any write, so Stop can still close them.
const restoredTabs = (async () => {
  try {
    for (const id of (await chrome.storage.session.get('pullTabs')).pullTabs ?? []) openTabs.add(id);
  } catch {
    /* no session storage: nothing to restore */
  }
})();
const idleWaiters = new Map(); // tab id -> resolve, called when that tab's page reports it has gone quiet
const removedWaiters = new Map(); // tab id -> resolve, called when that tab is closed (by Stop, or by the student)
// What each open pull tab has saved so far ({ label, sample } per capture), for that page's preview in the app. Per
// tab, so tabs loading at the same time (and the student's own browsing) never push each other's entries out.
const tabRecent = new Map();
const MAX_RECENT_PER_TAB = 400;
// Bumped by Stop. A page whose openPage started before the bump closes its tab (or never opens one).
let stopGen = 0;
const PRUNE_EVERY_MS = 3600e3;
const MAX_RECORD_CHARS = 3_000_000; // one saved response; bigger ones are counted, not kept
const MAX_RECORDS = 6000; // the oldest go first beyond this

// Commands only the Courseline app may give (through bridge.js, which runs on localhost only). The relay on Canvas
// pages never forwards these, and this check makes sure no other content-script context can send them either.
const APP_ONLY = new Set(['setCanvasHost', 'openPage', 'cancelPull', 'setPinned', 'sendMessage', 'refreshMail']);
const fromLocalApp = (sender) => {
  try {
    const u = new URL(sender.url);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab) return;
  if (APP_ONLY.has(msg?.type) && !fromLocalApp(sender)) return;
  if (msg?.type === 'setCanvasHost') {
    // From the bridge: the Canvas address typed into the Courseline app. Same rules as the popup's field.
    applyCanvasAddress(chrome.storage.local, msg.input).then(sendResponse, () => sendResponse({ ok: false, error: 'Could not save the address.' }));
    return true; // keep the channel open for the reply
  }
  if (msg?.type === 'openPage') {
    // From the bridge, for a run the student confirmed inside the Courseline app: load one Canvas page in a
    // background tab, wait for it, close it, and say what it brought in. One page at a time.
    // Several at once: bridge.js runs a few pages in parallel, each in its own background tab.
    openPage(msg.url, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  if (msg?.type === 'sendMessage') {
    // From the bridge, after a click on Send in the app: send it from a Canvas tab (see sendViaTab).
    sendViaTab(msg.request, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  if (msg?.type === 'refreshMail') {
    // From the bridge, when the student opens Messages in the app: read the inbox and threads (see refreshMailViaTab).
    refreshMailViaTab(sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  if (msg?.type === 'mailResult') {
    const waiter = mailWaiters.get(msg.nonce);
    if (waiter && waiter.tabId === sender.tab.id) waiter.resolve(msg);
    return;
  }
  if (msg?.type === 'sendResult') {
    // From the page script in the tab sendViaTab opened, with the nonce it was given.
    const waiter = sendWaiters.get(msg.nonce);
    if (waiter && waiter.tabId === sender.tab.id) waiter.resolve(msg);
    return;
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
  queue = queue.then(() => save(msg.url, msg.body, msg.operation, msg.variables, sender.url, msg.page, sender.tab.id)).catch(() => {});
});

async function save(url, body, operation, variables, senderUrl, page, tabId) {
  // A page can only speak for its own origin: a response claiming another origin's URL is dropped.
  if (!sameOrigin(url, senderUrl)) return;
  // Data read from the page itself (ENV, the grades table) has its own small set of kinds; the rest is API responses.
  const info = typeof page === 'string' ? classifyPage(page, url, body) : classify(url, body, operation, variables);
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
    // A GraphQL read keeps what it asked for (small, checked by inject.js): the Inbox, for one, asks the same query for
    // the inbox and the sent folder, and only its variables say which.
    if (url.endsWith('/api/graphql') && variables && typeof variables === 'object') record.variables = variables;
    if (JSON.stringify(record).length > MAX_RECORD_CHARS) {
      await chrome.storage.local.set({ skippedLarge: (store.skippedLarge ?? 0) + 1 });
      return;
    }
    await chrome.storage.local.set({ [`cap:${info.key}`]: record });
    noteRecent(info.unmapped, record.body, tabId);
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
    if (JSON.stringify(record).length > MAX_RECORD_CHARS) {
      await chrome.storage.local.set({ health, skippedLarge: (store.skippedLarge ?? 0) + 1 });
      return;
    }
    await chrome.storage.local.set({ [`cap:${info.key}`]: record, health });
    noteRecent(info.kind, body, tabId);
  } else {
    // Known route, unexpected shape: Courseline's screens must not read it as if it were the usual data, but nothing
    // is lost either. It is kept raw as kind "other", under its own key so it never replaces a good copy, the health
    // counter shows the mismatch, and its structure (names and types, no values) is kept once to write a reader.
    h.badShape += 1;
    h.lastBadAt = now;
    const { shapes = {} } = await chrome.storage.local.get('shapes');
    const label = `REJECTED ${info.kind}`;
    if (!shapes[label] && Object.keys(shapes).length < 100) shapes[label] = skeleton(body);
    const raw = { kind: 'other', route: info.route, rejectedAs: info.kind, courseId: info.courseId, host: info.host, url, capturedAt: now, body: stripSensitive(body) };
    const fits = JSON.stringify(raw).length <= MAX_RECORD_CHARS;
    await chrome.storage.local.set({ health, shapes, ...(fits ? { [`cap:rejected:${info.key}`]: raw } : { skippedLarge: (store.skippedLarge ?? 0) + 1 }) });
  }
  await pruneOld(now);
}

// Saved responses do not live forever: anything older than 90 days is deleted, checked at most once an hour.
// The last prune time is kept in memory too, so a capture does not need a storage read just to learn it is not time.
let lastPruneAt = null;
async function pruneOld(now) {
  lastPruneAt ??= (await chrome.storage.local.get('lastPrune')).lastPrune ?? 0;
  if (now - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now;
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

function noteRecent(label, body, tabId) {
  const list = tabRecent.get(tabId);
  if (!list) return; // not a tab a pull opened (or it has already finished)
  list.push({ label, sample: peekSample(body) });
  if (list.length > MAX_RECENT_PER_TAB) list.shift();
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
  stopGen += 1; // before anything is awaited: a page still opening sees it and closes its own tab
  await restoredTabs;
  // Each openPage removes its own id when its tab closes, so the list is not cleared here (that could drop a tab
  // added while this ran).
  for (const id of [...openTabs]) chrome.tabs.remove(id).catch(() => {});
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

// Sending a message (the owner's decision, Oct 29, 2026: the extension may send messages). The app's request is checked
// again here (lib/message.js), a Canvas tab is opened in the background on the saved address only, and the page's own
// script makes Canvas's documented request there, with the form token Canvas puts in the page (no cookie is read).
// The tab is the student's Settings page: Canvas's Inbox page carries no form token, its Settings page's forms do.
const SEND_FROM = '/profile/settings';
const SIGNED_OUT = 'You are not signed in to Canvas in this browser. Sign in to Canvas, then try again.';
// The page script says where it ran (this extension cannot read tab addresses): the Settings page on the saved Canvas.
const onSendPage = (where, host) => typeof where === 'string' && (where === `${host}${SEND_FROM}` || where.startsWith(`${host}${SEND_FROM}/`));
// Canvas's answer is saved, so the conversation shows the new message at once; the tab closes.
const sendWaiters = new Map(); // nonce -> { tabId, resolve }
async function sendViaTab(request, sender) {
  const req = cleanSendRequest(request);
  if (!req) return { ok: false, error: 'That message is empty or not complete.' };
  const { canvasHost } = await chrome.storage.local.get('canvasHost');
  if (!canvasHost) return { ok: false, error: 'Save your Canvas address first.' };
  const tab = await chrome.tabs.create({ url: `https://${canvasHost}${SEND_FROM}`, active: false, windowId: sender.tab?.windowId });
  try {
    if (!(await waitForLoad(tab.id))) return { ok: false, error: 'Canvas did not load. Try again.' };
    const nonce = crypto.randomUUID();
    const answer = new Promise((resolve) => sendWaiters.set(nonce, { tabId: tab.id, resolve }));
    const { path, payload } = sendRequestFor(req);
    await chrome.tabs.sendMessage(tab.id, { type: 'courseline-send', nonce, path, payload, files: req.files ?? [] });
    // Attachments are uploaded first, from the same tab: allow time for them.
    const result = await Promise.race([answer, sleep(30000 + (req.files?.length ?? 0) * 30000).then(() => ({ ok: false, error: 'Canvas did not answer in time. Check your Inbox in Canvas before sending again.' }))]);
    sendWaiters.delete(nonce);
    // Signed out of Canvas, the Settings page lands on the login screen instead (and nothing was sent from there).
    if (result.where !== undefined && !onSendPage(result.where, canvasHost)) return { ok: false, error: SIGNED_OUT };
    if (!result.ok) return { ok: false, error: result.error ?? 'Canvas did not take the message.' };
    // Saved like a capture (kind "conversation", Canvas's REST shape), so the app shows it straight away.
    const conversations = (Array.isArray(result.body) ? result.body : [result.body]).filter((c) => c && typeof c === 'object' && 'id' in c);
    queue = queue
      .then(() =>
        chrome.storage.local.set(
          Object.fromEntries(
            conversations.map((c, i) => [
              `cap:${canvasHost}/api/v1/conversations/${c.id}#sent:${Date.now()}:${i}`,
              { kind: 'conversation', courseId: null, host: canvasHost, url: `https://${canvasHost}/api/v1/conversations/${c.id}`, capturedAt: Date.now(), body: stripSensitive(c) },
            ]),
          ),
        ),
      )
      .catch(() => {});
    await queue;
    return { ok: true, result: result.body };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Reading messages when the student opens Messages in the app (the owner's decision, Oct 29, 2026: Canvas only loads a
// thread when it is clicked in its own Inbox, so the extension reads them itself, then). A Canvas tab in the background,
// its page script makes GET requests to Canvas's messages API only (inject.js), and the answers are saved in Canvas's
// REST shape (kind "conversation"); the tab closes. Not during Sync now, and at most every two minutes.
const mailWaiters = new Map(); // nonce -> { tabId, resolve }
const MAIL_EVERY_MS = 2 * 60e3;
async function refreshMailViaTab(sender) {
  const { canvasHost } = await chrome.storage.local.get('canvasHost');
  if (!canvasHost) return { ok: false, error: 'Save your Canvas address first.' };
  const last = await session('mailRefreshedAt', 0);
  if (Date.now() - last < MAIL_EVERY_MS) return { ok: true, skipped: true };
  await setSession({ mailRefreshedAt: Date.now() });
  const tab = await chrome.tabs.create({ url: `https://${canvasHost}${SEND_FROM}`, active: false, windowId: sender.tab?.windowId });
  try {
    if (!(await waitForLoad(tab.id))) return { ok: false, error: 'Canvas did not load. Try again.' };
    const nonce = crypto.randomUUID();
    const answer = new Promise((resolve) => mailWaiters.set(nonce, { tabId: tab.id, resolve }));
    await chrome.tabs.sendMessage(tab.id, { type: 'courseline-mail', nonce });
    const result = await Promise.race([answer, sleep(60000).then(() => ({ ok: false, error: 'Canvas did not answer in time.' }))]);
    mailWaiters.delete(nonce);
    if (result.where !== undefined && !onSendPage(result.where, canvasHost)) {
      await setSession({ mailRefreshedAt: 0 });
      return { ok: false, error: SIGNED_OUT };
    }
    if (!result.ok) return { ok: false, error: result.error ?? 'Canvas did not give the messages.' };
    const now = Date.now();
    const rec = (url, body) => ({ kind: 'conversation', courseId: null, host: canvasHost, url, capturedAt: now, body: stripSensitive(body) });
    const records = {};
    for (const scope of ['inbox', 'sent']) {
      if (Array.isArray(result.lists?.[scope])) records[`cap:${canvasHost}/api/v1/conversations?scope=${scope}`] = rec(`https://${canvasHost}/api/v1/conversations?scope=${scope}`, result.lists[scope]);
    }
    for (const c of Array.isArray(result.threads) ? result.threads : []) {
      if (c && Number.isInteger(c.id)) records[`cap:${canvasHost}/api/v1/conversations/${c.id}`] = rec(`https://${canvasHost}/api/v1/conversations/${c.id}`, c);
    }
    queue = queue.then(() => chrome.storage.local.set(records)).catch(() => {});
    await queue;
    return { ok: true, conversations: Object.keys(records).length };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Remembers that a page was opened, so a later "pull linked pages" skips it. Kept for a day (what the app's
// pendingLinks waits before opening a page again), not by count: a pass has no page limit, so a count would drop pages
// from the same pass and they would come back as "not opened". 50,000 is only a backstop.
const VISITED_TTL_MS = 24 * 3600e3;
const VISITED_BACKSTOP = 50_000;
async function markVisited(target) {
  const { visited = {} } = await chrome.storage.local.get('visited');
  const now = Date.now();
  visited[target.href.split('#')[0]] = now;
  let entries = Object.entries(visited).filter(([, at]) => typeof at === 'number' && now - at < VISITED_TTL_MS);
  if (entries.length > VISITED_BACKSTOP) entries = entries.sort(([, a], [, b]) => b - a).slice(0, VISITED_BACKSTOP);
  await chrome.storage.local.set({ visited: Object.fromEntries(entries) });
}

async function openPage(url, sender) {
  const gen = stopGen;
  const stoppedReply = { ok: true, loaded: false, stopped: true, captured: 0, items: [] };
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
  // No hourly cap and several tabs at once (the owner's choice); still only from a run started by a click in the app.
  if (gen !== stopGen) return stoppedReply; // Stop was pressed while this was starting
  // In the background of the window the student is already in: no new window, no focus change.
  const tab = await chrome.tabs.create({ url: target.href, active: false, windowId: sender.tab?.windowId });
  if (gen !== stopGen) {
    chrome.tabs.remove(tab.id).catch(() => {});
    return stoppedReply;
  }
  await restoredTabs;
  openTabs.add(tab.id);
  tabRecent.set(tab.id, []);
  await setSession({ pullTabs: [...openTabs] });
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
  openTabs.delete(tab.id);
  await setSession({ pullTabs: [...openTabs] });
  await queue; // let the captures from this page finish saving

  // Remember it was opened, so a later "pull linked pages" skips it, but only if it really loaded: a page that timed
  // out, or that Stop closed, is worth trying again. Newest 3,000 kept.
  if (loaded && !removed) {
    // Pages load in parallel: the read-modify-write of `visited` goes through the same queue as the captures.
    queue = queue.then(() => markVisited(target)).catch(() => {});
    await queue;
  }

  // What this page's tab brought in (other tabs load at the same time, so the tab says whose capture it was).
  const mine = tabRecent.get(tab.id) ?? [];
  tabRecent.delete(tab.id);
  const byLabel = new Map();
  for (const r of mine) {
    const e = byLabel.get(r.label) ?? { label: r.label, count: 0, sample: [] };
    e.count += 1;
    for (const name of r.sample) if (e.sample.length < 3 && !e.sample.includes(name)) e.sample.push(name);
    byLabel.set(r.label, e);
  }
  const items = [...byLabel.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  return { ok: true, loaded, stopped: removed, captured: items.reduce((n, i) => n + i.count, 0), items };
}

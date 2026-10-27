import { applyCanvasAddress } from './lib/canvasAddress.js';
import { keysToClear } from './lib/capture.js';
import { buildExport } from './lib/exportAll.js';
import { collectShapes } from './lib/shape.js';
import { ago, summarize } from './lib/summary.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // text only: captured names are untrusted
  return e;
};

function kindChips(kinds, now) {
  const chips = el('div', 'chips');
  for (const [kind, k] of Object.entries(kinds)) chips.append(el('span', 'chip', `${kind} ×${k.count} · ${ago(now, k.lastAt)}`));
  return chips;
}

async function render() {
  const now = Date.now();
  const s = summarize(await chrome.storage.local.get(null), now);

  $('summary').textContent = s.total
    ? `${s.courses.length} course${s.courses.length === 1 ? '' : 's'} with data · ${s.total} saved responses`
    : 'Nothing captured yet. Browse your Canvas and come back.';

  const coverage = $('coverage');
  coverage.replaceChildren();
  if (s.coverage) {
    const c = s.coverage;
    coverage.append(el('div', c.missing.length ? 'warn' : 'muted', `${c.synced} of ${c.total} current courses synced`));
    if (c.missing.length) {
      coverage.lastChild.append(
        el('div', null, `Open these in Canvas to add them: ${c.missing.map((m) => m.name ?? `Course ${m.id}`).join(', ')}`),
      );
    }
  } else if (s.total) {
    coverage.append(el('div', 'muted', 'Course list not seen yet. Open your Canvas dashboard to see how many courses are synced.'));
  }

  const store = await chrome.storage.local.get(['canvasHost', 'appPinned', 'skippedLarge']);
  // Show the saved address, but never overwrite what is being typed.
  const addr = $('addr');
  if (document.activeElement !== addr && !addr.dataset.dirty) addr.value = store.canvasHost ?? '';
  const hostBox = $('host');
  hostBox.replaceChildren();
  if (!store.canvasHost) hostBox.append(el('div', 'warn', 'Save your Canvas address above to start capturing. Until then nothing is kept, so a page you visit cannot pass itself off as your Canvas.'));
  if (Array.isArray(store.appPinned) && store.appPinned.length) {
    hostBox.append(el('div', null, `Courses chosen in Courseline: ${store.appPinned.length}`));
  }
  if (store.skippedLarge) {
    hostBox.append(el('div', null, `${store.skippedLarge} response${store.skippedLarge === 1 ? ' was' : 's were'} too large to keep (over 3 MB each).`));
  }

  const warn = $('warn');
  warn.replaceChildren();
  if (s.failing.length) {
    const box = el('div', 'warn');
    box.append(el('div', null, `Canvas sent an unexpected format for: ${s.failing.join(', ')}. That data is not being saved, so what you see may be out of date.`));
    box.append(el('div', null, 'What to do: open that page in Canvas once more, or press Sync now. If this keeps showing, Canvas has probably changed and Courseline needs an update: use "Copy response shapes" below and send what it copies to whoever maintains Courseline.'));
    warn.append(box);
  }

  const courses = $('courses');
  courses.replaceChildren();
  if (!s.courses.length) courses.append(el('div', 'muted', 'None yet.'));
  for (const c of s.courses) {
    const box = el('div', 'course');
    const row = el('div', 'row');
    row.append(el('span', 'name', c.name ?? `Course ${c.courseId}`), el('span', c.stale ? 'stale' : 'muted', `${c.stale ? 'stale · ' : ''}${ago(now, c.lastAt)}`));
    box.append(row, kindChips(c.kinds, now));
    courses.append(box);
  }

  const account = $('account');
  account.replaceChildren();
  if (s.account) {
    const box = el('div', 'course');
    const row = el('div', 'row');
    row.append(el('span', 'name', 'Account-wide'), el('span', s.account.stale ? 'stale' : 'muted', ago(now, s.account.lastAt)));
    box.append(row, kindChips(s.account.kinds, now));
    account.append(box);
  }

  const health = $('health');
  health.replaceChildren();
  if (!s.health.length) health.append(el('div', 'muted', 'No responses seen yet.'));
  else {
    const table = el('table');
    const head = el('tr');
    for (const h of ['Type', 'Saved', 'Unexpected format']) head.append(el('th', null, h));
    table.append(head);
    for (const h of s.health) {
      const tr = el('tr');
      tr.append(el('td', null, h.kind), el('td', null, String(h.ok)), el('td', h.failing ? 'bad' : null, String(h.badShape)));
      table.append(tr);
    }
    health.append(table);
  }

  const unmapped = $('unmapped');
  unmapped.replaceChildren();
  if (!s.unmapped.length) unmapped.append(el('div', 'muted', 'Nothing beyond what Courseline shows.'));
  else {
    unmapped.append(el('div', 'muted', 'Canvas data your pages loaded that Courseline has no screen for yet. It is saved in full: use Export everything to get it.'));
    const table = el('table');
    for (const u of s.unmapped.slice(0, 15)) {
      const tr = el('tr');
      tr.append(el('td', null, u.address), el('td', 'muted', `×${u.count}`));
      table.append(tr);
    }
    unmapped.append(table);
  }
}

// The exact Canvas address. Captures are accepted only from it, and Sync now opens its pages. Changing to a
// different address clears what was captured from the old one.
$('addr').addEventListener('input', (e) => {
  e.target.dataset.dirty = '1';
  $('addrMsg').textContent = '';
  $('addrMsg').className = 'muted';
});
$('saveAddr').addEventListener('click', async () => {
  const msg = $('addrMsg');
  const result = await applyCanvasAddress(chrome.storage.local, $('addr').value);
  if (!result.ok) {
    msg.textContent = result.error;
    msg.className = 'err';
    return;
  }
  msg.textContent = result.host
    ? `Saved. Courseline will only read ${result.host}. Press Sync now to fetch it.`
    : 'Address cleared. Nothing is captured until you save one.';
  msg.className = 'muted';
  delete $('addr').dataset.dirty;
  render();
});

// Everything captured, as one JSON file in the Downloads folder. Nothing is uploaded anywhere.
$('export').addEventListener('click', async (e) => {
  const data = buildExport(await chrome.storage.local.get(null));
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `courseline-capture-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  e.target.textContent = `Exported ${data.recordCount} responses`;
  setTimeout(() => (e.target.textContent = 'Export everything (JSON)'), 2500);
});

// Syncing happens inside Courseline, so the student confirms and watches it there. This brings the app forward and
// asks it to show the plan. An app tab that is already open is NOT navigated: that would reload it and destroy a run
// that is in progress.
$('sync').addEventListener('click', async () => {
  const { appOrigin } = await chrome.storage.local.get('appOrigin');
  if (!appOrigin) {
    $('addrMsg').textContent = 'Open Courseline once (for example http://localhost:5173) and it will remember where it is.';
    return;
  }
  const [existing] = await chrome.tabs.query({ url: `${appOrigin}/*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    chrome.tabs.sendMessage(existing.id, { type: 'openPlan' }).catch(() => {});
  } else {
    await chrome.tabs.create({ url: `${appOrigin}/settings?tab=connection&sync=1` });
  }
});

// Field names and types of what we have saved and of what we do not read yet. No values, so it is safe to paste.
$('copy').addEventListener('click', async (e) => {
  const shapes = collectShapes(await chrome.storage.local.get(null));
  try {
    await navigator.clipboard.writeText(JSON.stringify(shapes, null, 1));
    e.target.textContent = `Copied ${Object.keys(shapes.read).length + Object.keys(shapes.unread).length} shapes`;
  } catch {
    e.target.textContent = 'Could not copy';
  }
  setTimeout(() => (e.target.textContent = 'Copy response shapes'), 2500);
});

// Two clicks to clear, so it is never accidental.
let armed = false;
$('clear').addEventListener('click', async (e) => {
  if (!armed) {
    armed = true;
    e.target.textContent = 'Click again to delete everything captured';
    e.target.classList.add('armed');
    return;
  }
  await chrome.storage.local.remove(keysToClear(await chrome.storage.local.get(null)));
  armed = false;
  e.target.textContent = 'Clear captured data';
  e.target.classList.remove('armed');
  render();
});

render();
chrome.storage.onChanged.addListener(render);

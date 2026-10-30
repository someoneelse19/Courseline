// End-to-end test in a real Chrome: the unpacked extension, a mock Canvas (HTTPS), and the real Courseline app.
//   1. start the app:   npm run dev          (http://localhost:5173)
//   2. run this:        node e2e/run.mjs     (set CHROME_PATH if Chrome is not in the usual macOS place)
// It exits non-zero if any check fails. Screenshots go to e2e/screenshots/.
import fs from 'node:fs';
import { ensureCert, start, signIn, click, panel, waitDone, go, text, typeInto, sleep, dir, pageCount, APP } from './harness.mjs';
import { startMock, hits, apiLog } from './mock-canvas.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : detail ? `   (${detail})` : ''}`);
};
const section = (t) => console.log(`\n--- ${t}`);
const shot = (page, name) => {
  fs.mkdirSync(`${dir}/screenshots`, { recursive: true });
  return page.screenshot(`${dir}/screenshots/${name}.png`);
};

try {
  await fetch(APP).catch(() => {
    throw new Error(`The app is not running at ${APP}. Start it with: npm run dev`);
  });
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

ensureCert();
const mock = await startMock();
const h = await start();
let app;
try {
  section('login page and first sync');
  app = await h.openTab(APP);
  await h.waitFor(() => app.eval("document.readyState==='complete'"), 20000, 'the app to load');
  await h.waitFor(() => app.eval(`!!document.querySelector('input[aria-label="Your Canvas address"]')`), 20000, 'the login form');
  check('the extension marks the app page', (await app.eval('document.documentElement.dataset.courselineExtension')) === '0.1.0');
  const login = await text(app);
  check('the login page renders (does not crash) and offers the extension', /Your Canvas address/.test(login) && /Connect and load my courses/.test(login), login.slice(0, 120));
  await shot(app, '01-login');

  // Before any address is saved, a Canvas-looking page must not be able to make the extension keep anything.
  const stray = await h.openTab('https://canvas.test:8443/courses/1/assignments');
  await sleep(2500);
  const strayStore = await h.storage();
  check('nothing is kept from a Canvas-like page before the student saves an address', !Object.keys(strayStore).some((k) => k.startsWith('cap:')) && !strayStore.canvasHost);
  const strayTarget = (await h.browser.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && t.url.includes('/courses/1/assignments'));
  if (strayTarget) await h.browser.send('Target.closeTarget', { targetId: strayTarget.targetId });
  await sleep(500);

  await typeInto(app, 'Your Canvas address', 'https://canvas.test:8443/');
  const addressSavedAt = Date.now();
  await click(app, /Connect and load/);
  await waitDone(h, app);
  await sleep(1000);
  const afterSync = await text(app);
  check('it signed in by itself', /Welcome, Student/.test(afterSync), afterSync.slice(0, 120));
  // The dashboard and sidebar name courses by their code; the full names show only in the sync panel's sample lines,
  // which depend on timing, so match the codes (and that the unpinned course is not there).
  check('the three pinned courses are listed', /\bBIO101\b/.test(afterSync) && /\bHIS200\b/.test(afterSync) && /\bALG1\b/.test(afterSync) && !/\bCHE1\b/.test(afterSync));
  check('a grade is calculated from the captured scores', /80\.0%/.test(afterSync));
  // The extension's status is a collapsed item in the sidebar: a dot and a word, opened to the details (remembered).
  check('the sidebar shows the extension status, collapsed', /Extension/.test(afterSync) && !/3 of 3 courses synced/.test(afterSync));
  await click(app, /^Extension/, 'button[aria-expanded="false"]');
  await sleep(300);
  check('opened, it shows coverage', /3 of 3 courses synced/.test(await text(app)));
  await shot(app, '02-dashboard');

  let st = await h.storage();
  const caps = () => Object.entries(st).filter(([k]) => k.startsWith('cap:')).map(([, v]) => v);
  check('the Canvas address was saved', st.canvasHost === 'canvas.test:8443', st.canvasHost);
  check('only the pinned courses were kept (not the third)', !caps().some((r) => r.courseId === 3) && caps().some((r) => r.courseId === 1) && caps().some((r) => r.courseId === 2));
  check('a credential response was never stored', !JSON.stringify(st).includes('SECRET-JWT'));
  check('no write response was stored', !JSON.stringify(st).includes('mark_read'));
  check('pages were opened one run at a time and all closed again', (await pageCount(h)) === 2, `tabs: ${await pageCount(h)}`);

  section('pull linked pages');
  const pullLabel = /Pull \d+ linked pages?/;
  await click(app, pullLabel);
  await h.waitFor(async () => /This will open/.test(await panel(app)), 10000, 'the plan');
  check('the plan is shown in the page before anything opens', /Start/.test(await panel(app)) && /background tab/.test(await panel(app)));
  const hitsBefore = hits.filter((x) => x.startsWith('GET /courses/1/assignments/')).length;
  check('nothing was opened before Start', hitsBefore === 0);
  await click(app, /^Start$/);
  await waitDone(h, app);
  st = await h.storage();
  let t;
  check('assignment detail pages were opened', Object.keys(st.visited).some((u) => u.endsWith('/courses/1/assignments/5')) && Object.keys(st.visited).some((u) => u.endsWith('/courses/1/assignments/6')));

  section('a course whose school hides most tabs');
  await click(app, /^Close$/).catch(() => {});
  check('its assignment pages were opened from the Grades page, including one with no link', ['/courses/4/assignments/41', '/courses/4/assignments/42'].every((p) => Object.keys(st.visited).some((u) => u.endsWith(p))), Object.keys(st.visited).filter((u) => u.includes('/courses/4')).join(', '));
  {
    const page41 = Object.values(st).find((r) => r?.kind === 'assignmentPage' && String(r.body?.id) === '41');
    const body = JSON.stringify(page41?.body ?? null);
    check('each assignment page was read into its own record, without its date text', !!page41 && body.includes('Resuelve') && body.includes('/courses/4/files/77/download') && !body.includes('SECRETV') && !JSON.stringify(st).includes('20 de oct'), body.slice(0, 200));
  }
  check('the extension asked Canvas for no assignment itself', !apiLog.some((c) => /^\/api\/v1\/courses\/4\/assignments/.test(c.path)));
  await go(app, '/courses/4/assignments');
  await sleep(1500);
  t = await text(app);
  check('the list shows both assignments, with no hidden note', /Ecuaciones/.test(t) && /Práctica/.test(t) && !/not in this course/.test(t), t.slice(0, 300));
  await go(app, '/courses/4/assignments/41');
  await sleep(1500);
  t = await text(app);
  check('instructions and rubric from the server-rendered page', /Resuelve los ejercicios/.test(t) && /Procedimiento/.test(t) && !/No instructions provided/.test(t) && !/have not been synced/.test(t), t.slice(0, 300));
  await go(app, '/courses/4/assignments/42');
  await sleep(1500);
  t = await text(app);
  check('an empty description reads as none', /No instructions provided/.test(t), t.slice(0, 300));
  await go(app, '/courses/4/files');
  await sleep(1500);
  t = await text(app);
  check('a tab that really redirects keeps the "not in Canvas menu" wording', /is not in this course’s Canvas menu/.test(t), t.slice(0, 300));
  // The course synced on Everything, now that its menu is known: Discussions is opened although the menu leaves it out
  // (ALWAYS_TRIED in pullPlan.ts), while Quizzes, also left out, is skipped. (The course's own sync, which plans its
  // pages exactly as Sync now does: a full Sync now here would also open course 1's Discussions, which a later check
  // needs unsynced.)
  await go(app, '/courses/4');
  await sleep(1200);
  const syncStart = Date.now();
  await click(app, /Refresh this course/);
  await h.waitFor(async () => /This will open/.test(await panel(app)), 10000, 'the course sync plan');
  await app.eval(`(() => { const box = [...document.querySelectorAll('[role=dialog] input[type=checkbox]')].find((i) => /Essentials only/.test(i.closest('label')?.textContent ?? '')); if (box?.checked) box.click(); })()`, { userGesture: true });
  await sleep(300);
  await click(app, /^Start$/);
  await waitDone(h, app);
  await click(app, /^Close$/).catch(() => {});
  st = await h.storage();
  {
    const at = (p) => Object.entries(st.visited ?? {}).find(([u]) => u.endsWith(p))?.[1] ?? 0;
    check('a sync on Everything opens Discussions although the menu hides it, and skips Quizzes', at('/courses/4/discussion_topics') >= syncStart && at('/courses/4/quizzes') < syncStart, JSON.stringify({ syncStart, discussions: at('/courses/4/discussion_topics'), quizzes: at('/courses/4/quizzes') }));
  }
  await go(app, '/courses/4/announcements');
  await sleep(1500);
  t = await text(app);
  check('Discussions opened although not in the menu: empty, not hidden', /No discussions\./.test(t) && !/Discussions is not in this course/.test(t), t.slice(0, 300));
  await go(app, '/courses/4/grades');
  await sleep(1500);
  t = await text(app);
  // 72% is what the Grades page's own JavaScript wrote into the Total cell after the page was parsed; Courseline's own
  // figure from 7/10 would be 70%.
  check('Canvas\'s own total from the Grades page, read after Canvas filled it in', /72\.0%/.test(t) && !/Worked out by Courseline/.test(t), t.slice(0, 300));

  section('item screens fill in');
  await go(app, '/courses/1/assignments/5');
  await sleep(1500);
  t = await text(app);
  check('assignment instructions (REST detail)', /Write up the lab/.test(t) && !/No instructions provided/.test(t));
  check('assignment rubric', /Clarity/.test(t));
  await go(app, '/courses/1/assignments/6');
  await sleep(1500);
  t = await text(app);
  check('assignment instructions that only came through GraphQL', /only arrive through GraphQL/.test(t));
  await go(app, '/courses/1');
  await sleep(1500);
  check('the Pages tab shows a page body', /Read chapter one/.test(await text(app)));

  section('pull a page, refresh a kind, refresh a course, Stop');
  await click(app, /^Close$/).catch(() => {});
  await go(app, '/settings?tab=connection');
  await sleep(1200);
  await typeInto(app, 'Canvas page address', '/courses/1/announcements');
  await app.eval(`document.querySelector('input[aria-label="Canvas page address"]').form.requestSubmit()`, { userGesture: true });
  await h.waitFor(async () => /Visited 1 of 1/.test(await panel(app)), 60000, 'the single page');
  check('a single pasted page was pulled', /Welcome to Biology/.test(await panel(app)), await panel(app));
  await click(app, /^Close$/);
  await typeInto(app, 'Canvas page address', 'https://evil.test/courses/1');
  await app.eval(`document.querySelector('input[aria-label="Canvas page address"]').form.requestSubmit()`, { userGesture: true });
  await sleep(500);
  check('a page on another site is refused', /not on your Canvas address/.test(await text(app)));

  // While a sync is running the data refreshes in place: what the student is typing must survive it.
  await click(app, /^Grades:/);
  await h.waitFor(async () => /Visited 1 of 1/.test(await panel(app)), 60000, 'a refresh while typing');
  await sleep(2500);
  check('a half-typed field survives a sync (the app refreshes data in place, it does not rebuild itself)', (await app.eval(`document.querySelector('input[aria-label="Canvas page address"]')?.value`)) === 'https://evil.test/courses/1');
  await click(app, /^Close$/);

  await go(app, '/courses/1/announcements');
  await sleep(1500);
  t = await text(app);
  check('the announcements screen shows the announcement', /Welcome to Biology/.test(t), t.slice(0, 200));
  check('a list that was never pulled says "not synced", not "empty"', /Discussions has not been synced yet/.test(t) && !/No discussions\./.test(t), t.slice(0, 300));
  // Pull the discussions page too, from Settings.
  await go(app, '/settings?tab=connection');
  await sleep(1200);
  await typeInto(app, 'Canvas page address', '/courses/1/discussion_topics');
  await app.eval(`document.querySelector('input[aria-label="Canvas page address"]').form.requestSubmit()`, { userGesture: true });
  await h.waitFor(async () => /Visited 1 of 1/.test(await panel(app)), 60000, 'the discussions page');
  await click(app, /^Close$/);
  await go(app, '/courses/1/announcements');
  await sleep(1500);
  t = await text(app);
  check('both lists show once both pages were pulled', /Welcome to Biology/.test(t) && /Week 2 discussion/.test(t), t.slice(0, 200));
  await shot(app, '03-announcements');

  await go(app, '/courses/1/grades');
  await sleep(1200);
  await click(app, /^Grades:/);
  await h.waitFor(async () => /Visited 1 of 1/.test(await panel(app)), 60000, 'the chip refresh');
  check('clicking a freshness chip refreshes just that page, with no confirmation step', /Refresh grades/.test(await panel(app)));
  await click(app, /^Close$/);

  const baseline = await pageCount(h);
  await click(app, /Refresh this course/);
  await h.waitFor(async () => /This will open/.test(await panel(app)), 10000, 'the course plan');
  await click(app, /^Start$/);
  await sleep(3000);
  // A few pages load at once (CONCURRENCY in extension/lib/pullRunner.js): never more than that.
  const open = (await pageCount(h)) - baseline;
  check('while running, a few background tabs are open (at most 4)', open >= 1 && open <= 4, `tabs ${await pageCount(h)} vs ${baseline}`);
  await click(app, /^Stop$/);
  await waitDone(h, app, /Stopped\./, 60000);
  await sleep(1200);
  check('Stop ends the run and closes the tab', (await pageCount(h)) === baseline && /Stopped\./.test(await panel(app)));
  await click(app, /^Close$/);

  section('everything the pages read was picked up');
  await go(app, '/settings?tab=connection');
  await sleep(1000);
  await typeInto(app, 'Canvas page address', '/courses/1');
  await app.eval(`document.querySelector('input[aria-label="Canvas page address"]').form.requestSubmit()`, { userGesture: true });
  await h.waitFor(async () => /Visited 1 of 1/.test(await panel(app)), 60000, 'the course home page');
  await click(app, /^Close$/);
  await sleep(1500);
  {
    const st = await h.storage();
    const records = Object.entries(st).filter(([k]) => k.startsWith('cap:'));
    const stored = new Set(records.map(([, r]) => { const u = new URL(r.url); return u.pathname + u.search; }));
    // Every successful GET the pages made after the address was saved, for a pinned course (1, 2) or no course,
    // except the credential endpoint, must be in storage.
    const shouldHave = [...new Set(apiLog
      .filter((c) => c.at >= addressSavedAt && c.method === 'GET' && c.status === 200 && c.path !== '/api/v1/jwts' && !/^\/api\/v1\/courses\/3(\/|$)/.test(c.path))
      .map((c) => c.path + c.search))];
    const missing = shouldHave.filter((p) => !stored.has(p));
    check(`every API read the pages made was saved (${shouldHave.length - missing.length} of ${shouldHave.length})`, missing.length === 0, missing.slice(0, 5).join(', '));
    const keys = records.map(([k]) => k).join(' ');
    check('GraphQL reads are saved by name, whether sent through fetch, XHR or a Request object', ['GetAssignmentDetail', 'GetCourseHome', 'GetCourseOutline'].every((op) => keys.includes(`#${op}#`)), keys.slice(0, 200));
    check('a GraphQL mutation is never saved', !keys.includes('#MarkSeen#') && !JSON.stringify(st).includes('markSeen'));
    check('an XHR answered in JSON mode was read', records.some(([, r]) => r.kind === 'frontPage' && r.body?.title === 'Biology home'));
    check('a response in an unexpected format is kept raw instead of dropped', records.some(([k, r]) => k.startsWith('cap:rejected:') && r.rejectedAs === 'assignment' && r.body?.unusual === true));
    check('nothing from the unpinned course was kept', !records.some(([, r]) => r.courseId === 3));
  }

  section('the extension popup and its button');
  const popup = await h.openTab(`chrome-extension://${h.extId}/popup.html`);
  await sleep(1500);
  const pt = await text(popup);
  check('the popup lists the courses and coverage', /Biology 101/.test(pt) && /3 of 3 current courses synced/.test(pt), pt.slice(0, 150));
  await shot(popup, '04-popup');
  const pathBefore = await app.eval('location.pathname');
  await popup.eval(`document.getElementById('sync').click()`, { userGesture: true });
  await h.waitFor(async () => /This will open/.test(await panel(app)), 10000, 'the plan from the popup');
  check('"Sync in Courseline" shows the plan inside the app without navigating or reloading it', (await app.eval('location.pathname')) === pathBefore, pathBefore);
  await click(app, /^Cancel$/);

  section('log out and back in; switching address');
  const pathBeforeLogout = await app.eval('location.pathname');
  await click(app, /Log out/);
  await sleep(1200);
  check('logging out shows the login page', /Sign in with the extension/.test(await text(app)));
  await h.waitFor(() => app.eval(`[...document.querySelectorAll('button')].some((b) => /Sign in with the extension/.test(b.textContent) && !b.disabled)`), 20000, 'the sign-in button');
  await click(app, /Sign in with the extension/);
  await h.waitFor(() => app.eval(`!!document.querySelector('section[aria-label="Data from the Courseline extension"]')`), 20000, 'signing back in');
  check('signing back in did not touch the saved Canvas address', (await h.storage()).canvasHost === 'canvas.test:8443');
  check('signing back in works, and returns to the page it was on', (await app.eval('location.pathname')) === pathBeforeLogout, `${await app.eval('location.pathname')} vs ${pathBeforeLogout}`);
  const before = Object.keys(await h.storage()).filter((k) => k.startsWith('cap:')).length;
  await go(app, '/settings?tab=connection');
  await sleep(1200);
  await typeInto(app, 'Your Canvas address', 'other.example.edu');
  await click(app, /Save address/);
  await sleep(1500);
  st = await h.storage();
  check('switching to a different Canvas clears what came from the old one', before > 0 && Object.keys(st).filter((k) => k.startsWith('cap:')).length === 0 && st.canvasHost === 'other.example.edu');

  section('Clear captured data keeps the student\'s own settings');
  const popup2 = await h.openTab(`chrome-extension://${h.extId}/popup.html`);
  await sleep(1200);
  const hasCaps = async () => Object.keys(await h.storage()).some((k) => k.startsWith('cap:'));
  // put something back so there is something to clear
  await go(app, '/settings?tab=connection');
  await sleep(500);
  const beforeClear = await h.storage();
  await popup2.eval(`document.getElementById('clear').click()`, { userGesture: true });
  await popup2.eval(`document.getElementById('clear').click()`, { userGesture: true });
  await sleep(800);
  const afterClear = await h.storage();
  check('Clear captured data removes the captures', !(await hasCaps()));
  check('...but keeps the saved Canvas address and where the app lives', afterClear.canvasHost === beforeClear.canvasHost && !!afterClear.canvasHost && afterClear.appOrigin === beforeClear.appOrigin && !!afterClear.appOrigin, JSON.stringify({ before: beforeClear.canvasHost, after: afterClear.canvasHost }));

  section('page health');
  const problems = app.logs.filter((l) => /^(error|EXCEPTION)/i.test(l) || /csp|violat|refused to/i.test(l));
  check('no errors or Content-Security-Policy violations in the app console', problems.length === 0, problems.slice(0, 2).join(' | '));
  check('no errors in the extension background worker', h.sw.logs.filter((l) => /^(error|EXCEPTION)/i.test(l)).length === 0, h.sw.logs.slice(0, 2).join(' | '));
} catch (e) {
  check('the run completed without an exception', false, e.message);
  if (app) await shot(app, 'failure').catch(() => {});
  // What the extension and the page said, to tell why without re-running by hand.
  if (process.env.E2E_LOGS) {
    console.log('--- background worker log\n' + h.sw.logs.slice(-40).join('\n'));
    if (app) console.log('--- app page log\n' + app.logs.slice(-40).join('\n'));
  }
}
h.browser.kill();
mock.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

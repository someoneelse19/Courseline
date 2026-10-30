// Runs in the page's own JavaScript world (manifest: "world": "MAIN") so it can wrap fetch/XHR.
// Passive only: it reads responses Canvas's own frontend already asked for. It never reads cookies,
// never sends a request, and never changes what Canvas sees or receives.
//
// It is loaded on every https page because schools use custom Canvas domains, so it first decides whether the page
// IS Canvas. Until it is sure, same-origin /api/v1/ responses wait in a small in-memory buffer; if the page turns out
// not to be Canvas the buffer is thrown away and nothing ever leaves the page.
(() => {
  if (window.__courselineCapture) return;
  // This copy of the script; only the current copy acts on commands (a page only ever has one).
  const self = {};
  window.__courselineCapture = self;

  const TAG = 'courseline-capture';
  // Any Canvas API address (REST under /api/v1, /api/v2 and so on, and /api/graphql). Reads only: see report().
  const API = /^\/api\//;
  const MAX_BODY_CHARS = 4_000_000; // a response bigger than this is skipped rather than held in memory
  const MAX_BUFFER = 200;
  const GIVE_UP_MS = 4000;
  const IDLE_MS = 700; // quiet for this long after the load event = the page has finished its own requests

  // Canvas fingerprints: its body class, and the global `ENV` object its own pages define.
  function looksLikeCanvas() {
    try {
      if (document.body?.classList.contains('ic-app')) return true;
      const env = window.ENV;
      if (env && typeof env === 'object') return ['current_user_id', 'ASSET_HOST', 'DOMAIN_ROOT_ACCOUNT_ID'].some((k) => k in env);
    } catch {
      /* ignore */
    }
    return false;
  }

  let state = 'unknown'; // 'unknown' -> 'canvas' | 'other'
  let buffer = [];

  function send(item) {
    window.postMessage({ source: TAG, ...item }, location.origin);
  }

  function decide() {
    if (state !== 'unknown') return;
    if (looksLikeCanvas()) {
      state = 'canvas';
      buffer.forEach(send);
      buffer = [];
      whenParsed(readPage);
    }
  }

  // Some of a course never crosses /api/: Canvas builds it into the page. The student Grades page puts the
  // assignment groups (weights, drop rules, points) and the student's own scores in window.ENV and the assignment
  // names only in its table; the course home has its front page in ENV.WIKI_PAGE; the syllabus page has
  // ENV.SYLLABUS_BODY; an assignment's own page is drawn on the server; and which course tabs the school shows is only
  // in the course menu (and whether a list page really opened, only in where the tab landed). This reads those once the
  // page is known to be Canvas. Still passive: it reads what is already on the page, sends no request, reads no cookie.
  function whenParsed(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  let pageRead = false;
  let gradesSent = null; // { course, total }: the Grades page record already sent, and the total it carried
  function readPage() {
    if (pageRead) return;
    pageRead = true;
    try {
      const env = window.ENV;
      // Who is signed in (only the id and display name): Canvas's own pages never load the profile through the API.
      const me = env && typeof env.current_user === 'object' ? env.current_user : null;
      if (me && me.id && typeof me.display_name === 'string') {
        send({ url: `${location.origin}/#page:currentUser`, status: 200, body: { id: me.id, display_name: me.display_name }, page: 'currentUser' });
      }
      const course =
        /^course_(\d+)$/.exec(String(env?.context_asset_string ?? ''))?.[1] ?? /^\/courses\/(\d+)(\/|$)/.exec(location.pathname)?.[1];
      if (!course) return;
      const page = (kind, body) => send({ url: `${location.origin}/courses/${course}#page:${kind}`, status: 200, body, page: kind });

      const tabs = [...document.querySelectorAll('#section-tabs a[href]')].map((a) => ({ href: a.getAttribute('href'), label: a.textContent.trim() }));
      if (tabs.length) page('courseNav', { tabs });

      if (!env || typeof env !== 'object') return;
      if (env.WIKI_PAGE && typeof env.WIKI_PAGE === 'object') page('wikiPage', env.WIKI_PAGE);
      if (typeof env.SYLLABUS_BODY === 'string') page('syllabus', { syllabus_body: env.SYLLABUS_BODY });
      if (ownGradesPage(env) && Array.isArray(env.assignment_groups) && Array.isArray(env.submissions)) {
        const body = gradesPage(env);
        gradesSent = { course, total: body.canvas_total };
        page('gradesPage', body);
      }
      const ap = assignmentPage(env);
      if (ap && ap.course_id === course) page('assignmentPage', ap);
      // Only when this really is the list page: a school that hides the tab redirects to the course home instead, and
      // the extension cannot tell that from the address it asked for.
      const list = /^\/courses\/(\d+)\/(announcements|discussion_topics)\/?$/.exec(location.pathname);
      if (list && list[1] === course) page('listPage', { path: list[2] });
      readLatePage();
    } catch {
      // A page laid out differently: nothing read, and never disturb the page.
    }
  }

  // What Canvas keeps drawing after the page has loaded: the Modules page renders its items with JavaScript, and the
  // Grades page's own JavaScript fills in the Total cell (its ready handlers run after this script's DOMContentLoaded
  // listener, so the cell is usually still empty when the page is first read). Read when the page is parsed, on its
  // load event, and once more when it has gone quiet; sent again only when it changed.
  let lastModules = '';
  function readLatePage() {
    if (state !== 'canvas' || window.__courselineCapture !== self) return;
    readLateTotal();
    readLateModules();
  }

  function readLateTotal() {
    try {
      if (!gradesSent) return;
      const total = canvasTotal();
      if (total === undefined || total === gradesSent.total) return;
      const body = gradesPage(window.ENV);
      gradesSent.total = body.canvas_total;
      send({ url: `${location.origin}/courses/${gradesSent.course}#page:gradesPage`, status: 200, body, page: 'gradesPage' });
    } catch {
      /* never disturb the page */
    }
  }

  function readLateModules() {
    try {
      if (!/^\/courses\/\d+\/modules\/?$/.test(location.pathname) || !document.querySelector('#context_modules')) return;
      const course = /^\/courses\/(\d+)/.exec(location.pathname)[1];
      const body = modulesPage();
      const text = JSON.stringify(body);
      if (text === lastModules) return;
      lastModules = text;
      send({ url: `${location.origin}/courses/${course}#page:modulesPage`, status: 200, body, page: 'modulesPage' });
    } catch {
      /* never disturb the page */
    }
  }

  // The signed-in student's own Grades page: /courses/<id>/grades, or /courses/<id>/grades/<their own user id>
  // (linked from the all-courses grades page). Never someone else's (an observer's or a teacher's view).
  function ownGradesPage(env) {
    const m = /^\/courses\/\d+\/grades(?:\/(\d+))?\/?$/.exec(location.pathname);
    if (!m) return false;
    const me = String(env.current_user_id ?? env.current_user?.id ?? '');
    if (!me) return false;
    if (m[1] !== undefined && m[1] !== me) return false;
    return env.student_id === undefined || env.student_id === null || String(env.student_id) === me;
  }

  // The Grades page: ENV has the numbers, the table has the names. One row per assignment (tr#submission_<id>).
  // With grading periods the page shows one period (the current one, or ?grading_period_id=); which one is recorded,
  // and each period is kept as its own record, so viewing one never replaces another.
  function gradesPage(env) {
    const assignments = [];
    const groupNames = {};
    for (const row of document.querySelectorAll('#grades_summary tr.student_assignment')) {
      // One summary row per assignment group (tr#submission_group-<id>), every group, even one with no assignments.
      const groupRow = /^submission_group-(\d+)$/.exec(row.id)?.[1];
      const groupTitle = groupRow && row.querySelector('th.title')?.textContent.trim();
      if (groupTitle) groupNames[groupRow] = groupTitle;
      const id = /^submission_(\d+)$/.exec(row.id)?.[1];
      if (!id) continue;
      const link = row.querySelector('th.title a');
      const groupId = row.querySelector('.assignment_group_id')?.textContent.trim();
      const groupName = row.querySelector('th.title .context')?.textContent.trim();
      if (groupId && groupName) groupNames[groupId] ??= groupName;
      const href = link?.getAttribute('href') ?? '';
      // The row links to the submission; the assignment itself is the part before /submissions/.
      const assignmentPath = /^(\/courses\/\d+\/assignments\/\d+)/.exec(href)?.[1];
      assignments.push({
        id,
        name: link?.textContent.trim() ?? '',
        html_url: assignmentPath ? `${location.origin}${assignmentPath}` : undefined,
        assignment_group_id: groupId || undefined,
        // ENV.submissions has no missing/late flags; the row's status pill does.
        missing: !!row.querySelector('.submission-missing-pill'),
        late: !!row.querySelector('.submission-late-pill'),
        score_statistics: scoreStatistics(id),
      });
    }
    const period = new URLSearchParams(location.search).get('grading_period_id') ?? env.current_grading_period_id ?? env.grading_period_id;
    return {
      assignment_groups: env.assignment_groups,
      submissions: env.submissions,
      assignments,
      group_names: groupNames,
      grading_period_id: period === undefined || period === null || period === '' ? undefined : String(period),
      group_weighting_scheme: typeof env.group_weighting_scheme === 'string' ? env.group_weighting_scheme : undefined,
      canvas_total: canvasTotal(),
    };
  }

  // Canvas's own total as the Grades page shows it (the "Total" row), as a percentage. Only a percentage with exactly
  // one number in it is read; a hidden total, or a points-only display ("17.5 / 20"), gives nothing.
  function canvasTotal() {
    const text = document.querySelector('#submission_final-grade .grade')?.textContent ?? '';
    if (!text.includes('%')) return undefined;
    const tokens = text.match(/-?\d+(?:[.,]\d+)*/g) ?? [];
    if (tokens.length !== 1) return undefined;
    const n = parseShownNumber(tokens[0]);
    return Number.isFinite(n) && n >= 0 && n <= 1000 ? n : undefined;
  }

  // A number as the page shows it. The page's language does not say how Canvas writes numbers (a Spanish page still
  // writes 6.88), so each is read by its own shape: with both marks, the last one is the decimal mark; a single mark
  // followed by exactly three digits groups thousands (Canvas rounds statistics to two decimals); otherwise it is the
  // decimal mark.
  function parseShownNumber(token) {
    const t = token.replace(/[\s\u00a0\u202f]/g, '');
    const marks = t.match(/[.,]/g) ?? [];
    if (!marks.length) return Number(t);
    const last = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    const decimalAt = new Set(marks).size > 1 || (marks.length === 1 && t.length - last - 1 !== 3) ? last : -1;
    return Number([...t].map((c, i) => (i === decimalAt ? '.' : /[.,]/.test(c) ? '' : c)).join(''));
  }

  // The class statistics Canvas shows under an assignment (table#score_details_<id>), when the instructor shows them.
  // Three cells, labels in the student's language, so read by position: mean and median, high and upper quartile,
  // low and lower quartile.
  function scoreStatistics(id) {
    const cells = document.querySelectorAll(`#score_details_${id} tbody tr td`);
    if (cells.length < 3) return undefined;
    // Each cell holds exactly two numbers (mean and median, high and upper quartile, low and lower quartile).
    const nums = (cell) => (cell.textContent.match(/-?\d+(?:[.,\u00a0\u202f]\d+)*/g) ?? []).map(parseShownNumber);
    const [a, b, c] = [nums(cells[0]), nums(cells[1]), nums(cells[2])];
    if (a.length !== 2 || b.length !== 2 || c.length !== 2 || ![...a, ...b, ...c].every(Number.isFinite)) return undefined;
    return { mean: a[0], median: a[1], max: b[0], upper_q: b[1], min: c[0], lower_q: c[1] };
  }

  // An assignment's own page (/courses/<id>/assignments/<id>). Canvas draws it on the server and makes no API call for
  // it, so where the school hides the Assignments tab this is the only place its instructions and rubric show. The
  // title and instructions come from the HTML, the points and rubric from ENV. Never the dates: the page writes them
  // in the student's language ("20 de oct a las 11:15"), so .display_date, .display_time, .date_text and the
  // .student-assignment-overview list are not read, and no due_at, lock_at or unlock_at is sent. The due date comes
  // from the Grades page's ENV and planner items instead.
  function assignmentPage(env) {
    const m = /^\/courses\/(\d+)\/assignments\/(\d+)\/?$/.exec(location.pathname);
    if (!m) return null;
    const [, cid, aid] = m;
    if (String(env.ASSIGNMENT_ID) !== aid) return null;
    if (env.COURSE_ID !== undefined && String(env.COURSE_ID) !== cid) return null;
    if (!document.querySelector('#assignment_show')) return null;
    const name = document.querySelector('#assignment_show h1.title')?.textContent.replace(/\s+/g, ' ').trim();
    if (!name) return null;
    const body = { id: aid, course_id: cid, name, html_url: `${location.origin}/courses/${cid}/assignments/${aid}` };
    const description = document.querySelector('#assignment_show .description.user_content');
    if (description) {
      // The instructions as written: without the screen-reader text and icons Canvas adds inside them.
      const copy = description.cloneNode(true);
      copy.querySelectorAll('.screenreader-only, .ui-helper-hidden-accessible, .external_link_icon').forEach((e) => e.remove());
      body.description = copy.innerHTML.trim();
    }
    const points = env.ASSIGNMENT_POINTS_POSSIBLE;
    if ((typeof points === 'number' && Number.isFinite(points)) || (typeof points === 'string' && /^-?\d+(\.\d+)?$/.test(points))) body.points_possible = Number(points);
    // null: the assignment has no rubric. An object that is not laid out as expected is flagged, not guessed at.
    if (env.assigned_rubric && typeof env.assigned_rubric === 'object') {
      const rubric = rubricFrom(env.assigned_rubric);
      if (rubric) body.rubric = rubric;
      else body.rubric_unreadable = true;
    }
    return body;
  }

  // ENV.assigned_rubric in the API's rubric shape (criteria with their ratings). Canvas's Rubric model keeps the criteria
  // in `data`; `criteria` is read too. Anything not laid out as expected gives null (the whole rubric, never part of it).
  function rubricFrom(r) {
    const list = Array.isArray(r.criteria) ? r.criteria : Array.isArray(r.data) ? r.data : null;
    if (!list || !list.length) return null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
    const long = (o) => (typeof o.long_description === 'string' && o.long_description ? { long_description: o.long_description } : {});
    const text = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
    const out = [];
    for (const c of list) {
      if (!c || typeof c !== 'object' || !Array.isArray(c.ratings) || num(c.points) === null) return null;
      const ratings = [];
      for (const x of c.ratings) {
        if (!x || typeof x !== 'object' || num(x.points) === null) return null;
        ratings.push({ id: text(x.id), description: text(x.description), ...long(x), points: num(x.points) });
      }
      out.push({ id: text(c.id), description: text(c.description), ...long(c), points: num(c.points), ratings });
    }
    return out;
  }

  // The Modules page draws its modules into the HTML (no API call carries them). Per module: id, name and its items,
  // each with Canvas's own type and content id (from the item's `<Type>_<id>` class), title, link, indent and position.
  function modulesPage() {
    const modules = [];
    document.querySelectorAll('#context_modules .context_module[data-module-id]').forEach((m, mi) => {
      const id = m.getAttribute('data-module-id');
      if (!/^\d+$/.test(id ?? '')) return;
      const items = [];
      m.querySelectorAll('li.context_module_item').forEach((li, ii) => {
        const itemId = /^context_module_item_(\d+)$/.exec(li.id)?.[1];
        if (!itemId) return;
        const typed = [...li.classList].map((c) => /^([A-Z][A-Za-z]*(?:::[A-Za-z]+)?)_(\d+)$/.exec(c)).find(Boolean);
        const link = li.querySelector('.item_name a.title')?.getAttribute('href');
        // The visible title only: Canvas adds screen-reader text ("Links to an external site.") inside it.
        const titleEl = li.querySelector('.item_name .title')?.cloneNode(true);
        titleEl?.querySelectorAll('.screenreader-only, .ui-helper-hidden-accessible').forEach((e) => e.remove());
        const absolute = link && /^https?:\/\//i.test(link) && !link.startsWith(location.origin) ? link : undefined;
        items.push({
          id: itemId,
          canvas_type: typed?.[1],
          content_id: typed?.[2],
          title: titleEl?.textContent.replace(/\s+/g, ' ').trim() ?? '',
          html_url: link && link.startsWith('/') ? `${location.origin}${link}` : undefined,
          // An external link's address: Canvas puts it in .url, or links the title straight to it.
          external_url: li.querySelector('.item_name .url')?.textContent.trim() || absolute,
          indent: Number(/(?:^|\s)indent_(\d+)/.exec(li.className)?.[1] ?? 0),
          position: ii + 1,
        });
      });
      const name = m.querySelector('.ig-header .name')?.textContent.trim() || m.getAttribute('aria-label') || '';
      modules.push({ id, name, position: mi + 1, items });
    });
    return { modules };
  }

  function giveUp() {
    decide();
    if (state === 'unknown') {
      state = 'other';
      buffer = [];
    }
  }

  // Is the page still loading? Counts requests in flight; once the load event has fired and none has been in flight
  // for IDLE_MS, the page tells the extension it has gone quiet, so a pull can move to its next page right then
  // instead of waiting a fixed time. (Requests and responses are still only observed, never changed.)
  let inflight = 0;
  let idleTimer;
  function checkIdle() {
    clearTimeout(idleTimer);
    if (inflight > 0 || state !== 'canvas' || document.readyState !== 'complete') return;
    idleTimer = setTimeout(() => {
      if (inflight !== 0 || state !== 'canvas') return;
      // Last look at what Canvas draws after loading (module items render late), before saying the page is done.
      readLatePage();
      window.postMessage({ source: TAG, type: 'idle' }, location.origin);
    }, IDLE_MS);
  }
  const started = () => void inflight++;
  const ended = () => {
    inflight = Math.max(0, inflight - 1);
    checkIdle();
  };

  document.addEventListener('DOMContentLoaded', decide);
  window.addEventListener('load', () => {
    decide();
    readLatePage();
    checkIdle();
  });
  setTimeout(giveUp, GIVE_UP_MS);

  const isApiUrl = (raw) => {
    try {
      const u = new URL(raw, location.href);
      return u.origin === location.origin && API.test(u.pathname);
    } catch {
      return false;
    }
  };

  // Canvas's own frontend responses are prefixed with `while(1);` to defeat JSON hijacking.
  const parse = (text) => JSON.parse(text.replace(/^while\(1\);/, ''));

  // GraphQL calls all share one address, so the only way to tell them apart is the operation name the page sends,
  // plus its variables (which carry the course id). Never the query text.
  const WRITE_NAME = /^(create|update|delete|destroy|set|mark|add|remove|hide|unhide|subscribe|unsubscribe|submit|post|send|upsert|save|move|reorder|toggle|dismiss|archive|restore|accept|reject)/i;

  function graphqlRequest(init) {
    try {
      if (typeof init?.body !== 'string') return {};
      const parsed = JSON.parse(init.body);
      const ops = Array.isArray(parsed) ? parsed : [parsed];
      const names = ops.map((o) => o?.operationName).filter((n) => typeof n === 'string');
      const operation = names.length ? [...new Set(names)].slice(0, 3).join(',') : undefined;
      const vars = ops.length === 1 ? ops[0]?.variables : undefined;
      const variables = vars && typeof vars === 'object' && JSON.stringify(vars).length < 2000 ? vars : undefined;
      // A GraphQL "mutation" changes something; it is not a read, so it is not captured. Normally the query text
      // says so. A persisted query sends no text, only a name, so a name that reads like a change counts too.
      const textSaysMutation = ops.some((o) => typeof o?.query === 'string' && /^\s*mutation\b/.test(o.query));
      const noText = ops.every((o) => typeof o?.query !== 'string');
      const nameSaysChange = names.some((n) => WRITE_NAME.test(n));
      return { operation, variables, mutation: textSaysMutation || (noText && nameSaysChange) };
    } catch {
      return {};
    }
  }

  // `read` gives the parsed body: from text (fetch, XHR text) or as it already is (XHR in JSON mode).
  const fromText = (text) => () => {
    if (text.length > MAX_BODY_CHARS) throw new Error('too large');
    return parse(text);
  };

  function report(rawUrl, status, read, request = {}) {
    if (state === 'other') return;
    try {
      const url = new URL(rawUrl, location.href);
      if (url.origin !== location.origin || !API.test(url.pathname)) return;
      if (status < 200 || status >= 300) return;
      // Only reads: a REST write (POST, PUT, DELETE) or a GraphQL mutation is never saved.
      const isGraphql = url.pathname === '/api/graphql';
      if (!isGraphql && request.method && request.method !== 'GET') return;
      if (request.mutation) return;
      const item = { url: url.href, status, body: read(), operation: request.operation, variables: request.variables };
      if (state === 'canvas') return send(item);
      decide();
      if (state === 'canvas') return send(item);
      if (buffer.length < MAX_BUFFER) buffer.push(item);
    } catch {
      // Not JSON or not a URL: nothing to capture, and never disturb the page.
    }
  }

  const realFetch = window.fetch;

  // A message the student sent from Courseline (background.js sendViaTab opened this tab for it). Only Canvas's two
  // message endpoints, on this page's own origin, with the form token Canvas put in the page; the answer goes back to
  // the extension. A script on any page could post this command, but it would only make a request its own page can
  // make anyway.
  // Canvas's three-step upload (https://canvas.instructure.com/doc/api/file.file_uploads.html): ask this Canvas for a
  // slot in the student's own files, post the bytes where it says (often file storage on another host, so no
  // credentials go there), then take the file id from the answer or from the address it confirms with.
  async function uploadAttachment(f, headers) {
    try {
      if (!f || typeof f.name !== 'string' || typeof f.data !== 'string') return { ok: false, error: 'An attachment could not be read.' };
      const bin = atob(f.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: typeof f.type === 'string' ? f.type : 'application/octet-stream' });
      const slotRes = await realFetch.call(window, '/api/v1/users/self/files', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ name: f.name, size: blob.size, content_type: blob.type, parent_folder_path: 'conversation attachments', on_duplicate: 'rename' }),
      });
      const slot = slotRes.ok ? parse(await slotRes.text()) : null;
      if (!slot?.upload_url) return { ok: false, error: `Canvas did not take the attachment ${f.name} (${slotRes.status}).` };
      const form = new FormData();
      for (const [k, v] of Object.entries(slot.upload_params ?? {})) form.append(k, v);
      form.append(slot.file_param ?? 'file', blob, f.name); // the file goes last, as Canvas requires
      const target = new URL(slot.upload_url, location.href);
      const up = await realFetch.call(window, target.href, { method: 'POST', body: form, credentials: target.origin === location.origin ? 'same-origin' : 'omit' });
      let done = null;
      try {
        done = parse(await up.clone().text());
      } catch {
        /* not JSON: confirmed by address below */
      }
      if (up.ok && done && done.id) return { ok: true, id: done.id };
      const confirm = up.redirected ? up.url : up.headers.get('Location');
      if (confirm && new URL(confirm, location.href).origin === location.origin) {
        const c = await realFetch.call(window, confirm, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        const file = c.ok ? parse(await c.text()) : null;
        if (file?.id) return { ok: true, id: file.id };
      }
      return { ok: false, error: `Canvas did not confirm the attachment ${f.name} (${up.status}).` };
    } catch (e) {
      return { ok: false, error: `The attachment ${f?.name ?? ''} could not be uploaded: ${String(e?.message ?? e)}` };
    }
  }

  // The student opened Messages in Courseline (background.js refreshMailViaTab opened this tab for it): read the inbox,
  // the sent folder and each conversation's thread with Canvas's own messages API. Reads only (GET); a thread is read
  // with auto_mark_as_read=false, so nothing is marked read that the student has not read.
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (!m || m.source !== 'courseline-command' || m.type !== 'mail' || typeof m.nonce !== 'string' || window.__courselineCapture !== self) return;
    // `where`: the page this ran on, so the extension can tell a Canvas page from a login screen (it cannot read tab
    // addresses itself).
    const reply = (r) => window.postMessage({ source: TAG, type: 'mailResult', nonce: m.nonce, where: location.host + location.pathname, ...r }, location.origin);
    try {
      if (!looksLikeCanvas()) return reply({ ok: false, error: 'This is not a Canvas page.' });
      const get = async (path) => {
        const res = await realFetch.call(window, path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Canvas answered ${res.status} for ${path.split('?')[0]}`);
        return parse(await res.text());
      };
      const lists = {};
      for (const scope of ['inbox', 'sent']) lists[scope] = await get(`/api/v1/conversations?scope=${scope}&per_page=50`);
      const ids = [...new Set([...lists.inbox, ...lists.sent].map((c) => c?.id).filter((id) => Number.isInteger(id)))].slice(0, 100);
      const threads = [];
      for (const id of ids) threads.push(await get(`/api/v1/conversations/${id}?auto_mark_as_read=false`));
      reply({ ok: true, lists, threads });
    } catch (e) {
      reply({ ok: false, error: String(e?.message ?? e) });
    }
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (!m || m.source !== 'courseline-command' || m.type !== 'send' || typeof m.nonce !== 'string' || window.__courselineCapture !== self) return;
    const reply = (r) => window.postMessage({ source: TAG, type: 'sendResult', nonce: m.nonce, where: location.host + location.pathname, ...r }, location.origin);
    try {
      if (!looksLikeCanvas()) return reply({ ok: false, error: 'This is not a Canvas page.' });
      if (typeof m.path !== 'string' || !/^\/api\/v1\/conversations(\/\d{1,15}\/add_message)?$/.test(m.path) || !m.payload || typeof m.payload !== 'object') {
        return reply({ ok: false, error: 'Not a message request.' });
      }
      const token = document.querySelector('input[name="authenticity_token"]')?.value || document.querySelector('meta[name="csrf-token"]')?.content;
      if (!token) return reply({ ok: false, error: 'Canvas did not give its Settings page a form token, so the message was not sent. Send it from Canvas instead.' });
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' };
      // Attachments first, as Canvas's own Inbox does: each goes to the student's "conversation attachments" folder.
      const attachmentIds = [];
      for (const f of Array.isArray(m.files) ? m.files.slice(0, 10) : []) {
        const uploaded = await uploadAttachment(f, headers);
        if (!uploaded.ok) return reply({ ok: false, error: uploaded.error });
        attachmentIds.push(String(uploaded.id));
      }
      const payload = attachmentIds.length ? { ...m.payload, attachment_ids: attachmentIds } : m.payload;
      const res = await realFetch.call(window, m.path, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(payload) });
      const text = await res.text();
      let body = null;
      try {
        body = parse(text);
      } catch {
        /* not JSON */
      }
      if (!res.ok) return reply({ ok: false, error: body?.errors?.[0]?.message ?? `Canvas refused the message (${res.status}).` });
      reply({ ok: true, body });
    } catch (e) {
      reply({ ok: false, error: String(e?.message ?? e) });
    }
  });
  window.fetch = function (input, init) {
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // The operation name (and whether it is a mutation) comes from the request body: from `init`, or, when the page
    // passed a Request object, from a copy of its body taken before fetch uses it up.
    let requestInfo = Promise.resolve(graphqlRequest(init));
    if (input instanceof Request && init?.body === undefined && method !== 'GET' && method !== 'HEAD') {
      try {
        requestInfo = input.clone().text().then((body) => graphqlRequest({ body }), () => ({}));
      } catch {
        /* body already used: no name */
      }
    }
    started();
    const result = realFetch.apply(this, arguments);
    result.then(
      (res) => {
        const url = res.url || String(input instanceof Request ? input.url : input);
        // Only a same-origin /api/ response is ever read. Everything else (video, downloads, streams, other sites)
        // is never cloned or buffered: it simply counts as finished when the response arrives.
        if (state === 'other' || !isApiUrl(url)) return ended();
        let reading;
        try {
          reading = res.clone().text();
        } catch {
          return ended();
        }
        // The body can still be arriving when the response does, so "finished" waits for it too.
        Promise.all([reading, requestInfo]).then(
          ([text, info]) => {
            report(url, res.status, fromText(text), { ...info, method });
            ended();
          },
          ended,
        );
      },
      ended,
    );
    return result;
  };

  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    started();
    this.__courselineBody = typeof body === 'string' ? body : undefined;
    this.addEventListener('loadend', ended, { once: true });
    return realSend.apply(this, arguments);
  };

  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__courselineMethod = String(method).toUpperCase();
    this.__courselineUrl = String(url);
    // open() can be called again on the same object: listen once, and read whatever the latest open() set.
    if (!this.__courselineListening) {
      this.__courselineListening = true;
      this.addEventListener('load', () => {
        try {
          const request = { ...graphqlRequest({ body: this.__courselineBody }), method: this.__courselineMethod };
          const where = this.responseURL || this.__courselineUrl;
          if (this.responseType === '' || this.responseType === 'text') report(where, this.status, fromText(this.responseText), request);
          else if (this.responseType === 'json' && this.response !== null) report(where, this.status, () => this.response, request);
        } catch {
          /* ignore */
        }
      });
    }
    return realOpen.apply(this, arguments);
  };
})();

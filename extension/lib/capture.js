// Pure logic (no chrome.* calls) so it can be unit-tested: what a captured Canvas API response is, and whether its
// shape is the one Courseline reads. A response that matches a known route but fails its shape check is how we
// notice, instead of silently showing stale data, that Canvas changed something.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const allObjs = (v) => Array.isArray(v) && v.every(isObj);
const has = (o, ...keys) => isObj(o) && keys.every((k) => k in o);

// [kind, path pattern (after /api/v1), shape check applied to the body]
const ROUTES = [
  ['profile', /^\/users\/self\/profile$/, (b) => has(b, 'id')],
  ['courses', /^\/courses$/, allObjs],
  ['course', /^\/courses\/(\d+)$/, (b) => has(b, 'id')],
  ['assignments', /^\/courses\/(\d+)\/assignments$/, allObjs],
  ['assignment', /^\/courses\/(\d+)\/assignments\/(\d+)$/, (b) => has(b, 'id', 'name')],
  ['submission', /^\/courses\/(\d+)\/assignments\/(\d+)\/submissions\/(self|\d+)$/, (b) => has(b, 'id')],
  ['assignmentGroups', /^\/courses\/(\d+)\/assignment_groups$/, allObjs],
  ['modules', /^\/courses\/(\d+)\/modules$/, allObjs],
  ['moduleItems', /^\/courses\/(\d+)\/modules\/(\d+)\/items$/, allObjs],
  ['pages', /^\/courses\/(\d+)\/pages$/, allObjs],
  ['page', /^\/courses\/(\d+)\/pages\/[^/]+$/, (b) => has(b, 'url')],
  ['files', /^\/courses\/(\d+)\/files$/, allObjs],
  // The Files page lists a folder's files and subfolders here (no course in the address: each file names its course
  // in context_asset_string).
  ['folderContents', /^\/folders\/(\d+)\/all$/, allObjs],
  ['upcoming', /^\/users\/self\/upcoming_events$/, allObjs],
  ['announcements', /^\/announcements$/, allObjs],
  ['frontPage', /^\/courses\/(\d+)\/front_page$/, (b) => has(b, 'url')],
  ['discussions', /^\/courses\/(\d+)\/discussion_topics$/, allObjs],
  ['quizzes', /^\/courses\/(\d+)\/quizzes$/, allObjs],
  ['tabs', /^\/courses\/(\d+)\/tabs$/, allObjs],
  ['enrollments', /^\/courses\/(\d+)\/enrollments$/, allObjs],
  ['dashboardCards', /^\/dashboard\/dashboard_cards$/, allObjs],
  ['todo', /^\/users\/self\/todo$/, allObjs],
  ['missingSubmissions', /^\/users\/self\/missing_submissions$/, allObjs],
  ['colors', /^\/users\/self\/colors$/, (b) => has(b, 'custom_colors')],
  ['plannerItems', /^\/planner\/items$/, allObjs],
  ['calendarEvents', /^\/calendar_events$/, allObjs],
  ['userCourses', /^\/users\/self\/courses$/, allObjs],
  ['courseSubmissions', /^\/courses\/(\d+)\/students\/submissions$/, allObjs],
];

// Anything else Canvas's own pages fetch: noted by shape of the address only (ids replaced), never by content.
function pattern(path) {
  return path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) ? ':id' : seg))
    .join('/');
}

// GraphQL operations the learner dashboard makes that carry data worth keeping. Mutations (anything that changes
// state, like UpdateLearnerDashboardTabSelection) are deliberately not here.
export const GRAPHQL_READ = new Set([
  'GetUserCourses',
  'GetUserCourseWork',
  'GetUserCourseStatistics',
  'GetUserAnnouncements',
  'GetCourseAssignmentsAssetReports',
  'GetCourseInstructorsPaginated',
  'GetDashboardNotifications',
]);

const stable = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable)}]` : `{${Object.keys(v).sort().map((k) => `${k}:${stable(v[k])}`)}}`) : JSON.stringify(v));
const graphqlOk = (b) => isObj(b) && isObj(b.data) && !(Array.isArray(b.errors) && b.errors.length > 0);

// Everything a page reads is kept EXCEPT responses that carry credentials: a live auth token saved in the extension's
// storage would turn it into a token store. These are never saved, listed or shape-recorded.
const SECRET = [/^\/jwts$/, /\/(access_)?tokens?(\/|$)/, /^\/(login|logout|sessions?)(\/|$)/, /\/oauth2?(\/|$)/];

// Small, stable fingerprint for a GraphQL call that came without an operation name.
function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * @returns {{kind: string, courseId: number|null, shapeOk: boolean, key: string, host: string}
 *   | {kind: null, unmapped: string, courseId: number|null, key: string, host: string} | null}
 * null = not a Canvas API address, or one that carries credentials.
 * `kind: null` = an API address Courseline has no reader for yet: it is still saved in full (kind "other"), under the
 * address shape in `unmapped`.
 */
export function classify(rawUrl, body, operation, variables) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.pathname === '/api/graphql') {
    // The name comes from the page, so keep it to a short plain identifier list.
    if (GRAPHQL_READ.has(operation)) {
      const course = variables?.courseId ?? variables?.course_id;
      return {
        kind: operation,
        courseId: /^\d+$/.test(String(course ?? '')) ? Number(course) : null,
        shapeOk: graphqlOk(body),
        key: `${url.host}/api/graphql#${operation}#${stable(variables ?? {})}`,
        host: url.host,
        route: `POST /api/graphql ${operation}`,
      };
    }
    const named = typeof operation === 'string' && /^[A-Za-z0-9_,]{1,120}$/.test(operation) ? operation : null;
    const course = variables?.courseId ?? variables?.course_id;
    const topKeys = isObj(body) && isObj(body.data) ? Object.keys(body.data).sort().join(',') : '';
    return {
      kind: null,
      unmapped: `POST /api/graphql${named ? ` ${named}` : ''}`,
      courseId: /^\d+$/.test(String(course ?? '')) ? Number(course) : null,
      key: `${url.host}/api/graphql#${named ?? `anon-${fingerprint(topKeys)}`}#${stable(variables ?? {})}`,
      host: url.host,
    };
  }
  const path = url.pathname.replace(/^\/api\/v1/, '').replace(/\/$/, '');
  if (path === url.pathname) {
    // Another API version (or a path under /api/ that is not v1): saved as "other", by its full path.
    if (!/^\/api\//.test(url.pathname)) return null;
    const rest = url.pathname.replace(/\/$/, '');
    if (SECRET.some((re) => re.test(rest.replace(/^\/api\/[^/]+/, '')))) return null;
    const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
    return { kind: null, unmapped: `GET ${pattern(rest)}`, courseId: null, key: `${url.host}${rest}?${params}`, host: url.host };
  }
  for (const [kind, re, check] of ROUTES) {
    if (!re.test(path)) continue;
    // Paged lists are separate URLs; `page` differs, so each page is its own record. Query order must not matter.
    const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
    return {
      kind,
      courseId: /^\/courses\/(\d+)/.test(path) ? Number(/^\/courses\/(\d+)/.exec(path)[1]) : null,
      shapeOk: Boolean(check(body)),
      key: `${url.host}${path}?${params}`,
      host: url.host,
      route: `GET ${pattern(path)}`,
    };
  }
  if (SECRET.some((re) => re.test(path))) return null;
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const courseId = /^\/courses\/(\d+)/.exec(path);
  return {
    kind: null,
    unmapped: `GET ${pattern(path)}`,
    courseId: courseId ? Number(courseId[1]) : null,
    key: `${url.host}${path}?${params}`,
    host: url.host,
  };
}

// Data Canvas builds into the page itself instead of fetching it (window.ENV, and the page's HTML), read by inject.js
// once the page is recognised as Canvas. Some of a course only ever arrives this way: the student Grades page fetches
// no assignments or scores, the course home's front page is in ENV.WIKI_PAGE, and an assignment's own page is drawn on
// the server (no API call carries it). The kinds: courseNav, gradesPage, syllabus, wikiPage, modulesPage,
// assignmentPage (one per assignment), listPage (an Announcements or Discussions page that really opened, not a redirect
// to the course home) and currentUser. [kind, shape check]
const PAGE_KINDS = {
  courseNav: (b) => isObj(b) && allObjs(b.tabs) && b.tabs.every((t) => typeof t.href === 'string'),
  gradesPage: (b) => isObj(b) && allObjs(b.assignment_groups) && allObjs(b.submissions) && allObjs(b.assignments),
  syllabus: (b) => isObj(b) && typeof b.syllabus_body === 'string',
  wikiPage: (b) => has(b, 'url', 'title') && typeof b.body === 'string',
  modulesPage: (b) => isObj(b) && allObjs(b.modules) && b.modules.every((m) => allObjs(m.items)),
  assignmentPage: (b) =>
    has(b, 'id', 'name') &&
    /^\d{1,15}$/.test(String(b.id)) &&
    typeof b.name === 'string' &&
    b.name.length > 0 &&
    (b.description === undefined || typeof b.description === 'string') &&
    (b.points_possible === undefined || (typeof b.points_possible === 'number' && Number.isFinite(b.points_possible))) &&
    (b.rubric === undefined || (allObjs(b.rubric) && b.rubric.every((c) => allObjs(c.ratings)))),
  listPage: (b) => isObj(b) && (b.path === 'announcements' || b.path === 'discussion_topics'),
  // Not about a course: who is signed in. Filed under the Canvas root (`https://<host>/#page:currentUser`).
  currentUser: (b) => has(b, 'id', 'display_name'),
};
const ACCOUNT_PAGE_KINDS = new Set(['currentUser']);

/**
 * Classifies data read from a Canvas page (see PAGE_KINDS). `rawUrl` is `https://<host>/courses/<id>#page:...`.
 * A wiki page is filed as `frontPage` or `page`, the same kinds (and shape) as the API's, so the readers need nothing new.
 * @returns {{kind: string, courseId: number, shapeOk: boolean, key: string, host: string, route: string} | null}
 */
export function classifyPage(page, rawUrl, body) {
  if (!Object.hasOwn(PAGE_KINDS, page)) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const shapeOk = Boolean(PAGE_KINDS[page](body));
  if (ACCOUNT_PAGE_KINDS.has(page)) {
    if (url.pathname !== '/') return null;
    return { kind: page, courseId: null, shapeOk, key: `${url.host}/#page:${page}`, host: url.host, route: `PAGE / ${page}` };
  }
  const course = /^\/courses\/(\d+)$/.exec(url.pathname);
  if (!course) return null;
  let kind = page;
  let key = `${url.host}/courses/${course[1]}#page:${page}`;
  if (page === 'wikiPage') {
    kind = body?.front_page === true ? 'frontPage' : 'page';
    if (kind === 'page') key += `:${String(body?.url ?? '').slice(0, 200)}`;
  }
  // One record per grading period the Grades page showed, so viewing one period never replaces another.
  if (page === 'gradesPage' && /^\d{1,15}$/.test(String(body?.grading_period_id ?? ''))) key += `:gp${body.grading_period_id}`;
  // One record per assignment page, and one per list page (Announcements, Discussions).
  if (page === 'assignmentPage' && /^\d{1,15}$/.test(String(body?.id ?? ''))) key += `:a${body.id}`;
  if (page === 'listPage' && typeof body?.path === 'string') key += `:${body.path.slice(0, 40)}`;
  return { kind, courseId: Number(course[1]), shapeOk, key, host: url.host, route: `PAGE /courses/:id ${page}` };
}

/** Should a response about this course be kept? Always, until the pinned set is known; then only pinned courses. */
export function keepCourse(courseId, pinnedIds) {
  return courseId === null || !Array.isArray(pinnedIds) || pinnedIds.includes(courseId);
}

/** A capture is only believable if the URL it names is on the page that sent it: another origin's data is dropped. */
export function sameOrigin(url, senderUrl) {
  try {
    return new URL(url).origin === new URL(senderUrl).origin;
  } catch {
    return false;
  }
}

const SENSITIVE_KEYS = new Set([
  'email', 'primary_email', 'login_id', 'sis_user_id', 'integration_id', 'avatar_url', 'avatarUrl', 'avatar_image_url',
  // Credentials, wherever one turns up inside an otherwise ordinary response.
  'token', 'access_token', 'refresh_token', 'session_token', 'password', 'client_secret',
]);

// A "capability URL" works for anyone who has it, with no login: a calendar feed, or a file link carrying its
// `verifier`. They are credentials too, wherever they turn up. (In HTML the separator before a parameter is `&amp;`.)
const CAPABILITY_URL = /(?:[?&]|&amp;)verifier=|\/feeds\/(calendars|users)\/|\/sessionless_launch|(?:[?&]|&amp;)access_token=/i;
const CAPABILITY_PARAM = /(\?|&amp;|&)(?:verifier|access_token)=[^&#"'\s<>]*(&amp;|&)?/i;

/**
 * HTML (instructions, a page body) with the `verifier` and `access_token` parameters taken out of every link, so a file
 * link still leads to the file (the student's own login opens it) but no longer works for anyone else. Calendar feeds
 * and LTI `sessionless_launch` links are not rewritten: a string that still has one is dropped whole by stripSensitive
 * (which leaves `<key>_removed: true` in its place).
 */
export function scrubCapabilityParams(s) {
  // One parameter at a time, until none is left: "?verifier=x&b=1" -> "?b=1", "?a=1&amp;verifier=x" -> "?a=1",
  // "?verifier=x" -> "" (a lone `?` goes too).
  for (let i = 0; i < 1000 && CAPABILITY_PARAM.test(s); i++) {
    s = s.replace(CAPABILITY_PARAM, (m, sep, next) => (sep === '?' ? (next ? '?' : '') : (next ?? '')));
  }
  return s;
}

/** Copy of a response without email addresses, login ids, avatar links, credentials and capability URLs. */
export function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof v === 'string' && CAPABILITY_URL.test(v)) {
      // HTML keeps its links without the parameter; a plain URL field (or HTML still carrying a feed) is dropped.
      // Dropped HTML leaves a marker (`description_removed: true`), so the app can say the text was there but not kept
      // instead of "not synced yet", which no later sync would change.
      if (/<[a-z!/]/i.test(v)) {
        const scrubbed = scrubCapabilityParams(v);
        if (!CAPABILITY_URL.test(scrubbed)) out[key] = scrubbed;
        else out[`${key}_removed`] = true;
      }
      continue;
    }
    out[key] = stripSensitive(v);
  }
  return out;
}

// What "Clear captured data" removes: the captures and everything derived from them. NOT the student's own settings
// (the saved Canvas address, the courses chosen in the app, where the app lives): wiping those would silently stop
// capture and break the popup's buttons.
const DERIVED_KEYS = ['health', 'unmapped', 'shapes', 'visited', 'pinned', 'skippedLarge', 'lastPrune'];

export function keysToClear(all) {
  return Object.keys(all).filter((k) => k.startsWith('cap:') || DERIVED_KEYS.includes(k));
}

export const MAX_AGE_MS = 90 * 24 * 3600e3;

/** Storage keys of saved responses older than `maxAgeMs`. */
export function expiredKeys(all, now, maxAgeMs = MAX_AGE_MS) {
  return Object.entries(all)
    .filter(([key, rec]) => key.startsWith('cap:') && typeof rec?.capturedAt === 'number' && now - rec.capturedAt > maxAgeMs)
    .map(([key]) => key);
}

/** Valid course ids sent by the app: whole positive numbers, at most 200. Anything else is rejected (null). */
export function cleanPinnedIds(ids) {
  if (!Array.isArray(ids) || ids.length > 200) return null;
  return ids.every((n) => Number.isInteger(n) && n > 0) ? [...new Set(ids)] : null;
}

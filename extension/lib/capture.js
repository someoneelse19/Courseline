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
  'email', 'primary_email', 'login_id', 'sis_user_id', 'integration_id', 'avatar_url', 'avatarUrl',
  // Credentials, wherever one turns up inside an otherwise ordinary response.
  'token', 'access_token', 'refresh_token', 'session_token', 'password', 'client_secret',
]);

// A "capability URL" works for anyone who has it, with no login: a calendar feed, or a file link carrying its
// `verifier`. They are credentials too, wherever they turn up.
const CAPABILITY_URL = /[?&]verifier=|\/feeds\/(calendars|users)\/|\/sessionless_launch|[?&]access_token=/i;

/** Copy of a response without email addresses, login ids, avatar links, credentials and capability URLs. */
export function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (typeof v === 'string' && CAPABILITY_URL.test(v)) continue;
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

// "Load everyone" on the People tab in Courseline: the extension reads a course's whole class list (background.js
// loadPeopleViaTab, inject.js does the reading). Canvas's own People page loads its list in batches as it is scrolled,
// so passive capture usually has only the first batch, and a university-wide course can have tens of thousands.
// Pure helpers, kept apart so they can be tested.
import { stripSensitive } from './capture.js';

/** The record kind left once a course's whole list has been read (src/extension/extensionApi.ts PEOPLE_COMPLETE). */
export const PEOPLE_COMPLETE = 'peopleComplete';

/** A course id from the app: a positive whole number, else null. */
export function cleanCourseId(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Is this the address of one page of this course's class list, on this Canvas? */
export function isPeoplePage(url, host, courseId) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === host && u.pathname === `/api/v1/courses/${courseId}/users`;
  } catch {
    return false;
  }
}

/** Storage keys holding this course's class list, from a full load or from Canvas's own People page. */
export function isPeopleKey(key, host, courseId) {
  const prefixes = [`cap:${host}/courses/${courseId}/users?`, `cap:rejected:${host}/courses/${courseId}/users?`];
  return prefixes.some((p) => key.startsWith(p));
}

/** Only what the People tab shows: who, and in what role. (Never grades, which a student's own enrollment carries.) */
export function slimPerson(u) {
  if (!u || typeof u !== 'object') return null;
  const enrollments = Array.isArray(u.enrollments) ? u.enrollments.filter((e) => e && typeof e === 'object').map((e) => ({ type: e.type, role: e.role })) : [];
  return { id: u.id, name: u.name, sortable_name: u.sortable_name, short_name: u.short_name, enrollments };
}

/**
 * What to save from a full load: each page as a captured class-list page (kind "other", the route the app reads), and
 * the PEOPLE_COMPLETE marker with the count. Null when anything in it is not this course's list on this Canvas.
 */
export function peopleRecords(host, courseId, pages, now) {
  if (!Array.isArray(pages) || !pages.length) return null;
  const records = {};
  let count = 0;
  for (const [i, page] of pages.entries()) {
    if (!page || !isPeoplePage(page.url, host, courseId) || !Array.isArray(page.body)) return null;
    const body = stripSensitive(page.body.map(slimPerson).filter(Boolean));
    count += body.length;
    // Its own key per page (Canvas's next-page addresses carry opaque bookmarks), under the course's list prefix.
    records[`cap:${host}/courses/${courseId}/users?courseline_everyone=${i}`] = { kind: 'other', route: 'GET /courses/:id/users', courseId, host, url: page.url, capturedAt: now, body };
  }
  records[`cap:${host}/courses/${courseId}#${PEOPLE_COMPLETE}`] = { kind: PEOPLE_COMPLETE, courseId, host, url: `https://${host}/courses/${courseId}/users`, capturedAt: now, body: { count, pages: pages.length } };
  return { records, count };
}

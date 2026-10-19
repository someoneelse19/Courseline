// Which courses count as "pinned": the ones the student chose in the Courseline app (sent over the bridge and stored
// as `appPinned`), or, until they have chosen, the courses on their Canvas dashboard.
import { knownCourses, pinnedCourses } from './readers.js';

/** Ids to keep data for, or null when nothing is known yet (then nothing is filtered). */
export function effectivePinnedIds(store) {
  if (Array.isArray(store.appPinned) && store.appPinned.length) return store.appPinned;
  if (Array.isArray(store.pinned) && store.pinned.length) return store.pinned;
  return null;
}

/** The pinned courses as [{ id, name, concluded: false }], or null if neither source is known. */
export function pinnedList(all, records) {
  if (Array.isArray(all.appPinned) && all.appPinned.length) {
    const names = new Map();
    for (const r of records) if (r.kind === 'course' && r.body?.name) names.set(r.courseId, r.body.name);
    for (const c of knownCourses(records)?.courses ?? []) if (c.name && !names.has(c.id)) names.set(c.id, c.name);
    return all.appPinned.map((id) => ({ id, name: names.get(id) ?? null, concluded: false }));
  }
  return pinnedCourses(records);
}

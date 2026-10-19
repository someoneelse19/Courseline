// Pure readers: turn a captured response into plain data. Each returns null when the body is not the shape we saw,
// so a Canvas change shows up as "no data" instead of wrong data.

/** GetUserCourses -> [{ id: number, name: string|null, concluded: boolean }], one entry per course. */
export function readUserCourses(body) {
  const enrollments = body?.data?.legacyNode?.enrollments;
  if (!Array.isArray(enrollments)) return null;
  const byId = new Map();
  for (const e of enrollments) {
    const id = Number(e?.course?._id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const concluded = Boolean(e.concluded);
    const prev = byId.get(id);
    // A course counts as current if any of its enrollments is still open.
    byId.set(id, { id, name: typeof e.course.contextName === 'string' ? e.course.contextName : null, concluded: prev ? prev.concluded && concluded : concluded });
  }
  return [...byId.values()];
}

/** dashboardCards -> [{ id: number, name: string|null, concluded: false }]. Cards are the courses the dashboard shows. */
export function readDashboardCards(body) {
  if (!Array.isArray(body)) return null;
  const out = [];
  for (const card of body) {
    const id = Number(card?.id ?? /^course_(\d+)$/.exec(card?.assetString ?? '')?.[1]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const name = [card.longName, card.originalName, card.shortName].find((n) => typeof n === 'string' && n) ?? null;
    out.push({ id, name, concluded: false });
  }
  return out;
}

/** GET /users/self/courses -> [{ id, name, concluded }]. Courses Canvas hides by date come back without a name: skipped. */
export function readCourseList(body) {
  if (!Array.isArray(body)) return null;
  const out = [];
  for (const c of body) {
    const id = Number(c?.id);
    if (!Number.isInteger(id) || id <= 0 || typeof c.name !== 'string' || c.access_restricted_by_date) continue;
    const enrollments = Array.isArray(c.enrollments) ? c.enrollments : [];
    const concluded = c.workflow_state === 'completed' || (enrollments.length > 0 && enrollments.every((e) => e?.enrollment_state === 'completed'));
    out.push({ id, name: c.name, concluded });
  }
  return out;
}

/**
 * The courses the student has pinned: the ones on their Canvas dashboard. Null until the dashboard has been seen.
 * This is the set Courseline works with; other courses are neither synced nor counted.
 */
export function pinnedCourses(records) {
  const cards = records.filter((r) => r.kind === 'dashboardCards').sort((a, b) => b.capturedAt - a.capturedAt)[0];
  return cards ? readDashboardCards(cards.body) : null;
}

/**
 * The student's courses, from whatever has been captured: the dashboard's cards (current courses) and the full
 * course list (which also knows concluded ones). Returns null if neither has been seen.
 */
export function knownCourses(records) {
  const latest = (kind) => records.filter((r) => r.kind === kind).sort((a, b) => b.capturedAt - a.capturedAt)[0];
  const list = latest('GetUserCourses');
  const rest = latest('userCourses');
  const cards = latest('dashboardCards');
  const fromList = list ? readUserCourses(list.body) : null;
  const fromRest = rest ? readCourseList(rest.body) : null;
  const fromCards = cards ? readDashboardCards(cards.body) : null;
  if (!fromList && !fromRest && !fromCards) return null;

  // Weakest source first; later ones overwrite. Canvas's own REST course list knows concluded courses best.
  const byId = new Map();
  for (const c of fromList ?? []) byId.set(c.id, c);
  for (const c of fromRest ?? []) byId.set(c.id, c);
  // A course the dashboard shows is current, whatever the list says about its other enrollments.
  for (const c of fromCards ?? []) byId.set(c.id, { id: c.id, name: c.name ?? byId.get(c.id)?.name ?? null, concluded: false });
  return { courses: [...byId.values()], asOf: Math.max(list?.capturedAt ?? 0, rest?.capturedAt ?? 0, cards?.capturedAt ?? 0) };
}

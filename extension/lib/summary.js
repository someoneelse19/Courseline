// Pure: turns everything in chrome.storage.local into what the popup shows (coverage per course, freshness, health).

import { pinnedList } from './pinned.js';
import { knownCourses } from './readers.js';

const HOUR = 3600e3;
export const STALE_AFTER_MS = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 d ago" */
export function ago(now, then) {
  const s = Math.max(0, now - then) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function addKind(group, rec) {
  const k = (group.kinds[rec.kind] ??= { count: 0, lastAt: 0 });
  k.count += 1;
  k.lastAt = Math.max(k.lastAt, rec.capturedAt);
  group.lastAt = Math.max(group.lastAt, rec.capturedAt);
}

export function summarize(all, now = Date.now()) {
  const records = Object.entries(all)
    .filter(([key]) => key.startsWith('cap:'))
    .map(([, rec]) => rec);

  // Course names come from a single-course record or from any captured course list.
  const names = new Map();
  for (const r of records) {
    if (r.kind === 'course' && r.body?.name) names.set(r.courseId, r.body.name);
    if (r.kind === 'courses' && Array.isArray(r.body)) for (const c of r.body) if (c?.id && c.name) names.set(c.id, c.name);
  }

  // The student's own course list is what coverage is measured against.
  const known = knownCourses(records);
  for (const c of known?.courses ?? []) if (c.name && !names.has(c.id)) names.set(c.id, c.name);

  const byCourse = new Map();
  const account = { kinds: {}, lastAt: 0 };
  for (const r of records) {
    if (r.courseId == null) {
      addKind(account, r);
      continue;
    }
    if (!byCourse.has(r.courseId)) byCourse.set(r.courseId, { courseId: r.courseId, name: names.get(r.courseId) ?? null, kinds: {}, lastAt: 0 });
    addKind(byCourse.get(r.courseId), r);
  }

  // Only pinned courses are shown or counted once the dashboard has been seen.
  const pinned = pinnedList(all, records);
  const pinnedIds = pinned ? new Set(pinned.map((c) => c.id)) : null;
  for (const id of [...byCourse.keys()]) if (pinnedIds && !pinnedIds.has(id)) byCourse.delete(id);

  const courses = [...byCourse.values()].sort((a, b) => b.lastAt - a.lastAt).map((c) => ({ ...c, stale: now - c.lastAt > STALE_AFTER_MS }));

  const health = Object.entries(all.health ?? {})
    .map(([kind, h]) => ({ kind, ...h, failing: h.badShape > 0 && (h.lastBadAt ?? 0) >= (h.lastOkAt ?? 0) }))
    .sort((a, b) => a.kind.localeCompare(b.kind));

  let coverage = null;
  if (pinned) {
    const missing = pinned.filter((c) => !byCourse.has(c.id)).map((c) => ({ ...c, name: c.name ?? names.get(c.id) ?? null }));
    const asOf = Math.max(0, ...records.filter((r) => r.kind === 'dashboardCards').map((r) => r.capturedAt));
    coverage = { total: pinned.length, synced: pinned.length - missing.length, missing, concluded: 0, asOf };
  }

  const unmapped = Object.entries(all.unmapped ?? {})
    .map(([address, u]) => ({ address, ...u }))
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);

  return {
    total: records.length,
    unmapped,
    coverage,
    courses,
    account: Object.keys(account.kinds).length ? { ...account, stale: now - account.lastAt > STALE_AFTER_MS } : null,
    health,
    failing: health.filter((h) => h.failing).map((h) => h.kind),
  };
}

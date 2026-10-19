// Pure: everything captured, as one JSON document the student can download. Contains what Canvas sent to the pages
// the student opened (course content, grades, names), with email and credential fields already removed at capture.
export function buildExport(all, now = Date.now()) {
  const records = Object.entries(all)
    .filter(([key]) => key.startsWith('cap:'))
    .map(([, r]) => r)
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .map((r) => ({ kind: r.kind, route: r.route ?? null, courseId: r.courseId ?? null, url: r.url, capturedAt: new Date(r.capturedAt).toISOString(), body: r.body }));
  const counts = {};
  for (const r of records) counts[r.route ?? r.kind] = (counts[r.route ?? r.kind] ?? 0) + 1;
  return { exportedAt: new Date(now).toISOString(), canvasHost: all.canvasHost ?? null, recordCount: records.length, counts, records };
}

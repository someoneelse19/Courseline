import type { CapturedRecord, Snapshot } from './bridge';

export interface CapturedGroup {
  /** What the group is called: the kind we read, or the address shape for data with no reader yet. */
  label: string;
  /** True when Courseline has a screen built on it. */
  read: boolean;
  count: number;
  lastAt: number;
  records: CapturedRecord[];
}

/** Everything captured, grouped by kind or address shape, the most numerous first. */
export function groupCaptured(records: CapturedRecord[]): CapturedGroup[] {
  const groups = new Map<string, CapturedGroup>();
  for (const r of records) {
    const label = r.kind === 'other' && r.route ? r.route : r.kind;
    const g = groups.get(label) ?? { label, read: r.kind !== 'other', count: 0, lastAt: 0, records: [] };
    g.count += 1;
    g.lastAt = Math.max(g.lastAt, r.capturedAt);
    g.records.push(r);
    groups.set(label, g);
  }
  for (const g of groups.values()) g.records.sort((a, b) => b.capturedAt - a.capturedAt);
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** One JSON document with every captured response, oldest first. */
export function buildCaptureExport(snapshot: Snapshot, now: number = Date.now()) {
  const records = [...snapshot.records]
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .map((r) => ({ kind: r.kind, route: r.route ?? null, courseId: r.courseId, url: r.url, capturedAt: new Date(r.capturedAt).toISOString(), body: r.body }));
  return { exportedAt: new Date(now).toISOString(), canvasHost: snapshot.canvasHost, recordCount: records.length, records };
}

/** Pretty JSON, cut at `max` characters so a huge response cannot freeze the page. */
export function previewJson(value: unknown, max = 20000): { text: string; truncated: boolean } {
  const text = JSON.stringify(value, null, 1) ?? '';
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

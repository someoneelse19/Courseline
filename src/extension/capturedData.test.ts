import { describe, expect, it } from 'vitest';
import type { CapturedRecord, Snapshot } from './bridge';
import { buildCaptureExport, groupCaptured, previewJson } from './capturedData';

const rec = (kind: string, capturedAt: number, extra: Partial<CapturedRecord> = {}): CapturedRecord => ({ kind, courseId: 1, host: 'h', url: `https://h/${kind}/${capturedAt}`, capturedAt, body: { n: capturedAt }, ...extra });

describe('groupCaptured', () => {
  it('groups by kind, or by address shape for data with no reader, most numerous first', () => {
    const groups = groupCaptured([
      rec('course', 1),
      rec('other', 2, { route: 'GET /courses/:id/announcements' }),
      rec('other', 3, { route: 'GET /courses/:id/announcements' }),
      rec('other', 4, { route: 'GET /courses/:id/quizzes' }),
    ]);
    expect(groups.map((g) => [g.label, g.count, g.read])).toEqual([
      ['GET /courses/:id/announcements', 2, false],
      ['course', 1, true], // equal counts are ordered by name
      ['GET /courses/:id/quizzes', 1, false],
    ]);
    expect(groups[0].records.map((r) => r.capturedAt)).toEqual([3, 2]); // newest first
    expect(groups[0].lastAt).toBe(3);
  });
});

describe('buildCaptureExport', () => {
  it('has every response oldest first with the bodies', () => {
    const snapshot: Snapshot = { records: [rec('b', 20), rec('a', 10)], health: {}, appPinned: null, canvasHost: 'school.test', takenAt: 1 };
    const out = buildCaptureExport(snapshot, 99);
    expect(out.recordCount).toBe(2);
    expect(out.records.map((r) => r.kind)).toEqual(['a', 'b']);
    expect(out.records[0].body).toEqual({ n: 10 });
    expect(out.canvasHost).toBe('school.test');
  });
});

describe('previewJson', () => {
  it('cuts a large response and says so', () => {
    expect(previewJson({ a: 1 })).toMatchObject({ truncated: false });
    const big = previewJson({ text: 'x'.repeat(50000) }, 1000);
    expect(big.truncated).toBe(true);
    expect(big.text).toHaveLength(1000);
  });
});

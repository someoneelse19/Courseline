import { describe, expect, it } from 'vitest';
import { buildExport } from './exportAll.js';

describe('buildExport', () => {
  it('lists every saved response oldest first, with counts per kind or route', () => {
    const out = buildExport(
      {
        canvasHost: 'school.test',
        'cap:b': { kind: 'other', route: 'GET /a/:id', courseId: 1, url: 'u2', capturedAt: 2000, body: { x: 1 } },
        'cap:a': { kind: 'course', courseId: 1, url: 'u1', capturedAt: 1000, body: { id: 1 } },
        'cap:c': { kind: 'other', route: 'GET /a/:id', courseId: 2, url: 'u3', capturedAt: 3000, body: {} },
        health: {},
        pinned: [1],
      },
      5000,
    );
    expect(out.recordCount).toBe(3);
    expect(out.records.map((r) => r.url)).toEqual(['u1', 'u2', 'u3']);
    expect(out.counts).toEqual({ course: 1, 'GET /a/:id': 2 });
    expect(out.canvasHost).toBe('school.test');
    expect(out.exportedAt).toBe(new Date(5000).toISOString());
  });
});

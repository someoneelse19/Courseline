import { describe, expect, it } from 'vitest';
import { collectShapes, skeleton } from './shape.js';

describe('skeleton', () => {
  it('keeps names and types but no values', () => {
    const out = skeleton({ data: { user: { name: 'Ana Perez', score: 9.5, passed: true, grades: [{ title: 'Quiz 1', points: 3 }, { title: 'Quiz 2', points: 4 }], note: null } } });
    expect(out).toEqual({ data: { user: { name: 'string', score: 'number', passed: 'boolean', grades: [{ title: 'string', points: 'number' }], note: 'null' } } });
    expect(JSON.stringify(out)).not.toMatch(/Ana|Quiz|9\.5/);
  });

  it('handles empty arrays, and stops at a depth limit', () => {
    expect(skeleton({ a: [] })).toEqual({ a: [] });
    let deep = { v: 1 };
    for (let i = 0; i < 20; i++) deep = { n: deep };
    expect(JSON.stringify(skeleton(deep))).toContain('{…}');
  });
});

describe('collectShapes', () => {
  it('has one value-free skeleton per saved kind, plus the unread shapes', () => {
    const out = collectShapes({
      'cap:a': { kind: 'GetUserCourseWork', body: { data: { courseWork: [{ name: 'Essay', due: '2026-10-01' }] } } },
      'cap:b': { kind: 'GetUserCourseWork', body: { data: { other: 1 } } },
      'cap:c': { kind: 'course', body: { id: 7, name: 'Biology' } },
      shapes: { 'GET /x': { a: 'string' } },
      health: {},
    });
    expect(Object.keys(out.read).sort()).toEqual(['GetUserCourseWork', 'course']);
    expect(out.read.GetUserCourseWork).toEqual({ data: { courseWork: [{ name: 'string', due: 'string' }] } });
    expect(out.unread).toEqual({ 'GET /x': { a: 'string' } });
    expect(JSON.stringify(out)).not.toMatch(/Essay|Biology|2026/);
  });
});

import { describe, expect, it } from 'vitest';
import { peekSample } from './peek.js';

describe('peekSample', () => {
  it('takes the first few names from a list, preferring name then title', () => {
    expect(peekSample([{ name: 'Essay' }, { title: 'Quiz 1' }, { id: 3 }, { name: 'Lab' }, { name: 'Extra' }])).toEqual(['Essay', 'Quiz 1', 'Lab']);
  });

  it("uses a single object's own name, or the first list inside it", () => {
    expect(peekSample({ id: 1, name: 'Biology' })).toEqual(['Biology']);
    expect(peekSample({ view: [{ subject: 'Welcome' }] })).toEqual(['Welcome']);
  });

  it('finds names inside GraphQL data', () => {
    expect(peekSample({ data: { course: { assignmentsConnection: { nodes: [{ name: 'A1' }] } } } })).toEqual([]);
    expect(peekSample({ data: { items: [{ name: 'A1' }] } })).toEqual(['A1']);
  });

  it('returns nothing for data with no names', () => {
    expect(peekSample({ ok: true })).toEqual([]);
    expect(peekSample(null)).toEqual([]);
    expect(peekSample([1, 2, 3])).toEqual([]);
  });
});

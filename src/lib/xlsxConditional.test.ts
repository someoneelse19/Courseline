import { describe, expect, it } from 'vitest';
import { evaluateConditionalFormats, parseSqref, percentile, type CellValue, type ConditionalRule } from './xlsxConditional';

const rule = (r: Partial<ConditionalRule> & { type: string; sqref: string }): ConditionalRule => ({ ranges: parseSqref(r.sqref), priority: 1, stopIfTrue: false, formulas: [], ...r });
/** A sheet as rows of values (row 0 is A1's row). */
const sheet = (rows: CellValue[][]) => ({ at: (r: number, c: number) => rows[r]?.[c], bounds: { rows: rows.length, cols: Math.max(...rows.map((x) => x.length)) } });

describe('parseSqref', () => {
  it('reads ranges, single cells, several areas and whole columns', () => {
    expect(parseSqref('B2:D5')).toEqual([{ s: { r: 1, c: 1 }, e: { r: 4, c: 3 } }]);
    expect(parseSqref('A1 $C$3')).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }, { s: { r: 2, c: 2 }, e: { r: 2, c: 2 } }]);
    expect(parseSqref('B:B', { rows: 100, cols: 10 })).toEqual([{ s: { r: 0, c: 1 }, e: { r: 99, c: 1 } }]);
  });
});

describe('percentile', () => {
  it('interpolates like Excel\'s PERCENTILE', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([4, 5, 7, 8, 9], 0.5)).toBe(7);
  });
});

describe('evaluateConditionalFormats', () => {
  it('colors a 3-color scale: lowest red, 50th percentile yellow, highest green, mixed between', () => {
    const { at, bounds } = sheet([[4], [5], [7], [8], [9]]);
    const scale = rule({
      type: 'colorScale',
      sqref: 'A1:A5',
      colorScale: { cfvos: [{ type: 'min' }, { type: 'percentile', val: '50' }, { type: 'max' }], colors: ['#F8696B', '#FFEB84', '#63BE7B'] },
    });
    const out = evaluateConditionalFormats([scale], [], at, bounds);
    expect(out.get('0:0')?.bg).toBe('#F8696B');
    expect(out.get('2:0')?.bg).toBe('#FFEB84');
    expect(out.get('4:0')?.bg).toBe('#63BE7B');
    expect(out.get('1:0')?.bg).not.toMatch(/F8696B|FFEB84/);
  });

  it('draws data bars from 10% to 90% of the cell', () => {
    const { at, bounds } = sheet([[0], [5], [10]]);
    const bar = rule({ type: 'dataBar', sqref: 'A1:A3', dataBar: { cfvos: [{ type: 'min' }, { type: 'max' }], color: '#638EC6', showValue: true } });
    const out = evaluateConditionalFormats([bar], [], at, bounds);
    expect(out.get('0:0')?.bar?.length).toBeCloseTo(0.1);
    expect(out.get('1:0')?.bar?.length).toBeCloseTo(0.5);
    expect(out.get('2:0')?.bar).toEqual({ length: 0.9, color: '#638EC6' });
  });

  it('applies "cell value is" rules with their format, earlier priority winning, and stops at stopIfTrue', () => {
    const { at, bounds } = sheet([[3], [6], [9]]);
    const dxfs = [{ bg: '#FFC7CE', color: '#9C0006' }, { bg: '#C6EFCE', bold: true }, { italic: true }];
    const rules = [
      rule({ type: 'cellIs', sqref: 'A1:A3', operator: 'lessThan', formulas: ['$B$1'], dxfId: 0, priority: 2 }),
      rule({ type: 'cellIs', sqref: 'A1:A3', operator: 'greaterThanOrEqual', formulas: ['6'], dxfId: 1, priority: 1, stopIfTrue: true }),
      rule({ type: 'cellIs', sqref: 'A1:A3', operator: 'between', formulas: ['0', '100'], dxfId: 2, priority: 3 }),
    ];
    // B1 is empty: compared as 0, so "less than B1" matches nothing.
    let out = evaluateConditionalFormats(rules, dxfs, at, bounds);
    expect(out.get('0:0')).toEqual({ italic: true });
    expect(out.get('1:0')).toMatchObject({ bg: '#C6EFCE', bold: true });
    expect(out.get('2:0')?.italic).toBeUndefined(); // stopped
    const withB1 = sheet([[3, 5], [6], [9]]);
    out = evaluateConditionalFormats(rules, dxfs, withB1.at, withB1.bounds);
    expect(out.get('0:0')).toMatchObject({ bg: '#FFC7CE', color: '#9C0006', italic: true });
  });

  it('handles text, top N, above average, duplicates and blanks', () => {
    const { at, bounds } = sheet([['Pass', 1], ['Fail', 5], ['pass', 9], [null, 9]]);
    const hit = { bg: '#000000' };
    const keys = (r: ConditionalRule) => [...evaluateConditionalFormats([{ ...r, dxfId: 0 }], [hit], at, bounds).keys()].sort();
    expect(keys(rule({ type: 'containsText', sqref: 'A1:A4', text: 'PASS' }))).toEqual(['0:0', '2:0']);
    expect(keys(rule({ type: 'top10', sqref: 'B1:B4', rank: 1 }))).toEqual(['2:1', '3:1']);
    expect(keys(rule({ type: 'top10', sqref: 'B1:B4', rank: 1, bottom: true }))).toEqual(['0:1']);
    expect(keys(rule({ type: 'aboveAverage', sqref: 'B1:B4' }))).toEqual(['2:1', '3:1']);
    expect(keys(rule({ type: 'duplicateValues', sqref: 'A1:A4' }))).toEqual(['0:0', '2:0']);
    expect(keys(rule({ type: 'containsBlanks', sqref: 'A1:A4' }))).toEqual(['3:0']);
  });

  it('only looks at cells within bounds', () => {
    const { at } = sheet([[1], [2]]);
    const out = evaluateConditionalFormats([rule({ type: 'containsBlanks', sqref: 'A:A', dxfId: 0 })], [{ bg: '#000000' }], at, { rows: 5, cols: 1 });
    expect(out.size).toBe(3);
  });
});

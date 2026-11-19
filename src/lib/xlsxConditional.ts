// Excel conditional formatting, evaluated the way Excel does on the values the file has cached (no formulas are run).
// The rules are read from each sheet's XML (`readConditionalRules`, called by lib/xlsxStyles.ts); `evaluateConditionalFormats`
// turns them into a fill, font color or data bar per cell. Covered: color scales, data bars, "cell value is" comparisons
// (against numbers, text or a cell), text contains / begins / ends, top/bottom N or N%, above/below average, duplicate or
// unique values, and blanks. Not covered (the cell keeps its own formatting): formula rules, icon sets, dates occurring.
import type { CellStyle } from './xlsxStyles';

export interface CellRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}
export interface Cfvo {
  type: string; // min | max | num | percent | percentile | formula | autoMin | autoMax
  val?: string;
}
export interface ConditionalRule {
  ranges: CellRange[];
  priority: number;
  stopIfTrue: boolean;
  type: string;
  operator?: string;
  formulas: string[];
  text?: string;
  dxfId?: number;
  colorScale?: { cfvos: Cfvo[]; colors: string[] };
  dataBar?: { cfvos: Cfvo[]; color: string; showValue: boolean };
  rank?: number;
  percent?: boolean;
  bottom?: boolean;
  aboveAverage?: boolean;
  equalAverage?: boolean;
  stdDev?: number;
}
export interface ConditionalResult {
  bg?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  /** A data bar: its length (0..1 of the cell) and color. */
  bar?: { length: number; color: string };
  hideValue?: boolean;
}
export type CellValue = number | string | boolean | null | undefined;

/** "A1:C3 E5" -> ranges (0-based). Whole columns or rows ("A:A", "3:3") reach to `limit`. */
export function parseSqref(sqref: string, limit = { rows: 1048576, cols: 16384 }): CellRange[] {
  const out: CellRange[] = [];
  for (const part of sqref.trim().split(/\s+/)) {
    const [a, b = a] = part.replace(/\$/g, '').split(':');
    const one = (ref: string, end: boolean) => {
      const m = ref.match(/^([A-Z]*)(\d*)$/i);
      if (!m) return null;
      const c = m[1] ? colOf(m[1]) : end ? limit.cols - 1 : 0;
      const r = m[2] ? Number(m[2]) - 1 : end ? limit.rows - 1 : 0;
      return { r, c };
    };
    const s = one(a, false);
    const e = one(b, true);
    if (s && e) out.push({ s: { r: Math.min(s.r, e.r), c: Math.min(s.c, e.c) }, e: { r: Math.max(s.r, e.r), c: Math.max(s.c, e.c) } });
  }
  return out;
}
function colOf(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel's PERCENTILE (inclusive, interpolated). `sorted` ascending. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const k = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}

const hexRgb = (c: string) => {
  const h = c.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** A literal from a rule's formula: a number, a quoted string, TRUE/FALSE, or a reference to a cell (read with `at`). */
function operand(formula: string, at: (r: number, c: number) => CellValue): CellValue | typeof UNKNOWN {
  const f = formula.trim().replace(/^=/, '');
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(f)) return Number(f);
  const str = f.match(/^"((?:[^"]|"")*)"$/);
  if (str) return str[1].replace(/""/g, '"');
  if (/^(true|false)$/i.test(f)) return /^true$/i.test(f);
  const ref = f.match(/^\$?([A-Z]{1,3})\$?(\d+)$/i);
  if (ref) return at(Number(ref[2]) - 1, colOf(ref[1]));
  return UNKNOWN;
}
const UNKNOWN = Symbol('unknown');

function compare(a: CellValue, b: CellValue): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === null || a === undefined || a === '') a = typeof b === 'number' ? 0 : '';
  if (b === null || b === undefined) b = typeof a === 'number' ? 0 : '';
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase().localeCompare(b.toLowerCase());
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  // Excel orders numbers < text < booleans.
  const rank = (v: CellValue) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  return rank(a) - rank(b);
}

function cfvoValue(cfvo: Cfvo | undefined, sorted: number[], fallback: number, at: (r: number, c: number) => CellValue): number {
  if (!cfvo || !sorted.length) return fallback;
  const n = Number(cfvo.val);
  switch (cfvo.type) {
    case 'min':
    case 'autoMin':
      return sorted[0];
    case 'max':
    case 'autoMax':
      return sorted[sorted.length - 1];
    case 'num':
      return Number.isFinite(n) ? n : fallback;
    case 'percent':
      return Number.isFinite(n) ? sorted[0] + ((sorted[sorted.length - 1] - sorted[0]) * n) / 100 : fallback;
    case 'percentile':
      return Number.isFinite(n) ? percentile(sorted, n / 100) : fallback;
    case 'formula': {
      const v = operand(cfvo.val ?? '', at);
      return typeof v === 'number' ? v : fallback;
    }
  }
  return fallback;
}

/**
 * Each formatted cell ("r:c", 0-based) and what the rules give it. Rules apply in priority order (lowest number first);
 * a property set by an earlier rule wins, and `stopIfTrue` ends the list for that cell. `bounds` limits the cells looked
 * at (whole-column rules would otherwise cover a million rows).
 */
export function evaluateConditionalFormats(
  rules: ConditionalRule[],
  dxfs: CellStyle[],
  at: (r: number, c: number) => CellValue,
  bounds: { rows: number; cols: number },
): Map<string, ConditionalResult> {
  const out = new Map<string, ConditionalResult>();
  const stopped = new Set<string>();
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
    const cells: { key: string; r: number; c: number; v: CellValue }[] = [];
    for (const range of rule.ranges)
      for (let r = range.s.r; r <= Math.min(range.e.r, bounds.rows - 1); r++)
        for (let c = range.s.c; c <= Math.min(range.e.c, bounds.cols - 1); c++) cells.push({ key: `${r}:${c}`, r, c, v: at(r, c) });
    if (!cells.length) continue;
    const numbers = cells.map((x) => x.v).filter((v): v is number => typeof v === 'number');
    const sorted = [...numbers].sort((a, b) => a - b);
    const dxf = rule.dxfId !== undefined ? dxfs[rule.dxfId] : undefined;

    let test: ((v: CellValue) => boolean) | null = null;
    switch (rule.type) {
      case 'cellIs': {
        const a = operand(rule.formulas[0] ?? '', at);
        const b = operand(rule.formulas[1] ?? '', at);
        if (a === UNKNOWN || (b === UNKNOWN && /between/i.test(rule.operator ?? ''))) break;
        const op = rule.operator ?? 'equal';
        test = (v) => {
          if (v === null || v === undefined || v === '') v = typeof a === 'number' ? 0 : '';
          const d = compare(v, a as CellValue);
          if (d === null) return false;
          switch (op) {
            case 'equal': return d === 0;
            case 'notEqual': return d !== 0;
            case 'greaterThan': return d > 0;
            case 'greaterThanOrEqual': return d >= 0;
            case 'lessThan': return d < 0;
            case 'lessThanOrEqual': return d <= 0;
            case 'between':
            case 'notBetween': {
              const d2 = compare(v, b as CellValue);
              const lo = compare(a as CellValue, b as CellValue)! <= 0;
              const inside = lo ? d >= 0 && d2! <= 0 : d <= 0 && d2! >= 0;
              return op === 'between' ? inside : !inside;
            }
          }
          return false;
        };
        break;
      }
      case 'containsText':
      case 'notContainsText':
      case 'beginsWith':
      case 'endsWith': {
        const needle = (rule.text ?? '').toLowerCase();
        test = (v) => {
          const s = v === null || v === undefined ? '' : String(v).toLowerCase();
          if (rule.type === 'containsText') return s.includes(needle);
          if (rule.type === 'notContainsText') return !s.includes(needle);
          if (rule.type === 'beginsWith') return s.startsWith(needle);
          return s.endsWith(needle);
        };
        break;
      }
      case 'containsBlanks':
        test = (v) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
        break;
      case 'notContainsBlanks':
        test = (v) => !(v === null || v === undefined || (typeof v === 'string' && !v.trim()));
        break;
      case 'containsErrors':
      case 'notContainsErrors':
        test = () => rule.type === 'notContainsErrors';
        break;
      case 'top10': {
        if (!sorted.length) break;
        const rank = rule.rank ?? 10;
        const count = rule.percent ? Math.max(1, Math.floor((sorted.length * rank) / 100)) : rank;
        const cut = rule.bottom ? sorted[Math.min(sorted.length, count) - 1] : sorted[Math.max(0, sorted.length - count)];
        test = (v) => typeof v === 'number' && (rule.bottom ? v <= cut : v >= cut);
        break;
      }
      case 'aboveAverage': {
        if (!numbers.length) break;
        const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        const sd = Math.sqrt(numbers.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, numbers.length - 1));
        const above = rule.aboveAverage !== false;
        const limit = mean + (above ? 1 : -1) * (rule.stdDev ?? 0) * sd;
        test = (v) => typeof v === 'number' && (above ? (rule.equalAverage ? v >= limit : v > limit) : rule.equalAverage ? v <= limit : v < limit);
        break;
      }
      case 'duplicateValues':
      case 'uniqueValues': {
        const counts = new Map<string, number>();
        const norm = (v: CellValue) => (typeof v === 'string' ? `s${v.toLowerCase()}` : `${typeof v}${String(v)}`);
        for (const x of cells) if (x.v !== null && x.v !== undefined && x.v !== '') counts.set(norm(x.v), (counts.get(norm(x.v)) ?? 0) + 1);
        test = (v) => v !== null && v !== undefined && v !== '' && (rule.type === 'duplicateValues' ? (counts.get(norm(v)) ?? 0) > 1 : counts.get(norm(v)) === 1);
        break;
      }
    }

    for (const cell of cells) {
      if (stopped.has(cell.key)) continue;
      const res = out.get(cell.key) ?? {};
      let matched = false;
      if (rule.colorScale && typeof cell.v === 'number' && sorted.length) {
        const { cfvos, colors } = rule.colorScale;
        const stops = cfvos.map((c, i) => cfvoValue(c, sorted, i === 0 ? sorted[0] : sorted[sorted.length - 1], at));
        const v = cell.v;
        let color = colors[0];
        if (v >= stops[stops.length - 1]) color = colors[colors.length - 1];
        else
          for (let i = 0; i < stops.length - 1; i++)
            if (v <= stops[i + 1]) {
              const span = stops[i + 1] - stops[i];
              color = v <= stops[i] ? colors[i] : mix(colors[i], colors[i + 1], span ? (v - stops[i]) / span : 0);
              break;
            }
        res.bg ??= color;
        matched = true;
      } else if (rule.dataBar && typeof cell.v === 'number' && sorted.length) {
        const lo = cfvoValue(rule.dataBar.cfvos[0], sorted, sorted[0], at);
        const hi = cfvoValue(rule.dataBar.cfvos[1], sorted, sorted[sorted.length - 1], at);
        const f = hi > lo ? Math.min(1, Math.max(0, (cell.v - lo) / (hi - lo))) : 1;
        res.bar ??= { length: 0.1 + 0.8 * f, color: rule.dataBar.color };
        if (!rule.dataBar.showValue) res.hideValue = true;
        matched = true;
      } else if (test && test(cell.v)) {
        if (dxf) {
          res.bg ??= dxf.bg;
          res.color ??= dxf.color;
          res.bold ??= dxf.bold;
          res.italic ??= dxf.italic;
          res.strike ??= dxf.strike;
          res.underline ??= dxf.underline;
        }
        matched = true;
      }
      if (matched) {
        out.set(cell.key, res);
        if (rule.stopIfTrue) stopped.add(cell.key);
      }
    }
  }
  return out;
}

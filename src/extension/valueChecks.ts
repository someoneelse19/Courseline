// Checks on values the extension captured that are valid JSON of the right shape but cannot be right: a date with no
// time zone or in the year 20026, a number written "8,5", class statistics misread by a factor. The shape checks in
// the extension (lib/capture.js) catch a Canvas that changed its format; these catch a value that was read wrong.
// Each check either passes the value (dates converted to UTC "Z", numbers to numbers) or drops it, and says what it
// dropped to an IssueSink, so the Extension item in the sidebar can list it. Unknown (null, undefined, '') is never a
// problem and never 0.
//
// Pure: no imports from extensionApi, so both it and the screens can use these.
import { t } from '../i18n';

export type ValueIssueKind = 'date' | 'number' | 'statistics' | 'rubric';

/** One value Courseline left out because it did not add up. */
export interface ValueIssue {
  kind: ValueIssueKind;
  courseId?: number;
  itemId?: number;
  /** What the student would recognise it by (an assignment's or announcement's title). */
  item?: string;
  field: string;
  value: unknown;
  reason: string;
}

export type IssueSink = (issue: ValueIssue) => void;
export const ignoreIssues: IssueSink = () => {};

/** Where a value came from, for the issue raised when it is dropped. */
export interface IssueContext {
  courseId?: number;
  itemId?: number;
  item?: string;
  field: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const unknownValue = (v: unknown) => v === null || v === undefined || v === '';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const INSTANT_NO_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/;

/**
 * An instant as the app compares and sorts them: ISO 8601 in UTC with "Z". A string already in "Z" is kept exactly as
 * it is (the API's own form); one with an offset ("+02:00", as Canvas writes dates into its pages) is converted.
 * Null, undefined and '' are unknown, which is fine. Anything else is refused: date-only, no time zone (it could be any
 * zone), localized text, or a year outside 2000-2100.
 */
export function normalizeInstant(v: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (unknownValue(v)) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, reason: 'not a date' };
  if (!INSTANT.test(v)) return { ok: false, reason: INSTANT_NO_ZONE.test(v) ? 'no time zone' : 'not a date' };
  // "+0200" is valid ISO 8601 but not every engine parses it: write the colon in.
  const ms = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (!Number.isFinite(ms)) return { ok: false, reason: 'not a date' };
  const year = new Date(ms).getUTCFullYear();
  if (year < 2000 || year > 2100) return { ok: false, reason: 'year out of range' };
  return { ok: true, value: v.endsWith('Z') ? v : new Date(ms).toISOString().replace('.000Z', 'Z') };
}

/** normalizeInstant, reporting what it refused. Undefined means dropped; null means unknown. */
export function checkedInstant(v: unknown, ctx: IssueContext, sink: IssueSink): string | null | undefined {
  const r = normalizeInstant(v);
  if (r.ok) return r.value;
  sink({ kind: 'date', ...ctx, value: v, reason: r.reason });
  return undefined;
}

/**
 * A number as Canvas sends it: a finite number, or a numeric string with a dot for decimals ("8.5"). "8,5" is refused
 * rather than guessed. Undefined means dropped; null means unknown ('' and null are unknown, never 0).
 */
export function checkedNumber(v: unknown, ctx: IssueContext, sink: IssueSink): number | null | undefined {
  if (unknownValue(v)) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  sink({ kind: 'number', ...ctx, value: v, reason: 'not a number' });
  return undefined;
}

/**
 * Class statistics read from the page, only when they make sense: every number finite, and in order (low, lower
 * quartile, median, upper quartile, high), with the mean in range. Anything else was misread and is left out.
 */
export function sensibleStatistics(stats: unknown, pointsPossible?: unknown): Obj | undefined {
  if (!isObj(stats)) return undefined;
  const order = ['min', 'lower_q', 'median', 'upper_q', 'max'].map((k) => stats[k]).filter((v) => v !== undefined && v !== null);
  const { min, max, mean, median } = stats;
  if (![min, max, mean, median].every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
  if (!order.every((v, i) => typeof v === 'number' && Number.isFinite(v) && (i === 0 || v >= (order[i - 1] as number)))) return undefined;
  if ((mean as number) < (min as number) || (mean as number) > (max as number)) return undefined;
  // Every number misread by the same factor stays in order, so also check them against what the assignment is worth.
  // A misread is off by a factor of 10, 100 or 1000 (6.88 read as 688); real extra credit is not (a 1-point bonus whose
  // median is 2 and high 3), so only a median over 5 times the points or a high over 10 times them is refused.
  const points = Number(pointsPossible);
  if (points > 0 && ((median as number) > points * 5 || (max as number) > points * 10)) return undefined;
  return stats;
}

/** sensibleStatistics, reporting statistics that were there and did not make sense (none at all is not a problem). */
export function checkedStatistics(stats: unknown, points: unknown, ctx: IssueContext, sink: IssueSink): Obj | undefined {
  if (unknownValue(stats)) return undefined;
  const kept = sensibleStatistics(stats, points);
  if (!kept) sink({ kind: 'statistics', ...ctx, value: stats, reason: 'out of order or out of scale' });
  return kept;
}

// Fields only other kinds of object have (a user, a module, a folder, a group, a course, a conversation).
const NOT_ASSIGNMENT_KEYS = ['display_name', 'short_name', 'sortable_name', 'items_count', 'group_weight', 'course_code', 'participants', 'full_name', 'folders_count'];

/**
 * Can this object, found anywhere in the captured data because it has the same id, be this course's assignment? Ids
 * are only unique per kind, so a user, a module or another course's assignment can share it. Canvas's GraphQL often
 * sends no __typename, so a missing one is not held against it; anything that says it is something else is.
 */
export function looksLikeAssignmentOf(o: Record<string, unknown>, courseId: number, id: number): boolean {
  if (typeof o.__typename === 'string' && o.__typename !== 'Assignment') return false;
  // Its own link, when it has one, must be this assignment's (and not /assignments/410 for 41).
  const ownLink = new RegExp(`/courses/${courseId}/assignments/${id}(?!\\d)`);
  for (const key of ['html_url', 'htmlUrl']) {
    const url = o[key];
    if (typeof url === 'string' && !ownLink.test(url)) return false;
  }
  for (const key of ['course_id', 'courseId']) {
    if (o[key] !== undefined && o[key] !== null && Number(o[key]) !== courseId) return false;
  }
  if (NOT_ASSIGNMENT_KEYS.some((k) => k in o)) return false;
  if ('start_at' in o && 'end_at' in o) return false; // a calendar event or a term
  return true;
}

/** One issue per kind, course, item and field (the same value is checked by every screen that reads it). */
export function dedupeIssues(list: ValueIssue[]): ValueIssue[] {
  const seen = new Map<string, ValueIssue>();
  for (const i of list) {
    const key = `${i.kind}|${i.courseId ?? ''}|${i.itemId ?? ''}|${i.field}`;
    if (!seen.has(key)) seen.set(key, i);
  }
  return [...seen.values()];
}

// Written out (not built from pieces) so each string is greppable and translated.
function kindLabel(kind: ValueIssueKind): string {
  switch (kind) {
    case 'date':
      return t('dates');
    case 'number':
      return t('points or scores');
    case 'statistics':
      return t('class statistics');
    case 'rubric':
      return t('rubric');
  }
}

/**
 * The issues as short lines for the student, one per course and kind: "Algebra · dates: Ecuaciones, Práctica". At most
 * `max` lines; `more` is how many lines were left out.
 */
export function issueSummary(issues: ValueIssue[], courseNames: ReadonlyMap<number, string | null>, max = 4): { lines: string[]; more: number } {
  const groups = new Map<string, { courseId?: number; kind: ValueIssueKind; items: string[] }>();
  for (const i of issues) {
    const key = `${i.courseId ?? ''}|${i.kind}`;
    const g = groups.get(key) ?? { courseId: i.courseId, kind: i.kind, items: [] };
    const name = i.item?.trim() || (i.itemId !== undefined ? `#${i.itemId}` : i.field);
    if (!g.items.includes(name)) g.items.push(name);
    groups.set(key, g);
  }
  const lines = [...groups.values()].map((g) => {
    const course = g.courseId === undefined ? t('Other') : (courseNames.get(g.courseId) ?? `#${g.courseId}`);
    const items = g.items.slice(0, 3).join(', ') + (g.items.length > 3 ? ', …' : '');
    return `${course} · ${kindLabel(g.kind)}: ${items}`;
  });
  return { lines: lines.slice(0, max), more: Math.max(0, lines.length - max) };
}

// A CanvasApi (the same shape createCanvasApi returns) that answers from what the browser extension captured
// instead of calling Canvas. Pages and hooks do not know the difference.
//
// What the extension has is the JSON Canvas's own pages loaded, so: ids can be strings, some lists are missing until
// the student visits that page (or runs Sync now), and anything that needs to WRITE to Canvas, or fetch a file, is not
// possible without a token. Those calls reject with a plain explanation.
import { CanvasApiError } from '../api/client';
import type { CanvasApi } from '../api/canvas';
import type { Assignment, AssignmentGroup, Course, CourseFile, DiscussionTopic, Enrollment, Module, ModuleItem, Page, Submission, UpcomingEvent, UserProfile } from '../api/types';
import { computeGrade, toModel } from '../lib/grades';
import type { CapturedRecord, Snapshot } from './bridge';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const asArray = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** Canvas's own pages return most ids as strings; the app's types use numbers. Converts `id` and `*_id` fields, deeply. */
export function normalizeIds<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeIds) as T;
  if (!isObj(value)) return value;
  const out: Obj = {};
  for (const [key, v] of Object.entries(value)) {
    const isIdKey = key === 'id' || key.endsWith('_id');
    out[key] = isIdKey && typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : normalizeIds(v);
  }
  return out as T;
}

const notSynced = (what: string) => new CanvasApiError(`${what} has not been synced yet. Open it in Canvas, or press Sync now.`, 404, 'not_found');
const needsToken = (): Promise<never> =>
  Promise.reject(new CanvasApiError('This needs a Canvas access token. Sign in with a token to use it.', 403, 'forbidden'));

/** First defined value among the given keys (Canvas's REST uses snake_case, its GraphQL camelCase). */
function pick(o: Obj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

/**
 * Every object anywhere in the captured bodies that has this id (as `id` or `_id`), indexed once. A page opened by a
 * pull can bring the same item back in Canvas's newer GraphQL form, which has no reader of its own; looking it up by
 * id lets the screens use what is there without a reader per query.
 */
function indexById(records: CapturedRecord[]): Map<string, Obj[]> {
  const index = new Map<string, Obj[]>();
  let budget = 400_000;
  const walk = (v: unknown, depth: number) => {
    if (budget-- < 0 || depth > 14 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const o = v as Obj;
    for (const key of ['id', '_id']) {
      const id = o[key];
      if ((typeof id === 'string' || typeof id === 'number') && String(id).length < 20) {
        const list = index.get(String(id)) ?? [];
        list.push(o);
        index.set(String(id), list);
      }
    }
    for (const x of Object.values(o)) walk(x, depth + 1);
  };
  for (const r of records) walk(r.body, 0);
  return index;
}

/** An assignment's fields, from any object that looks like it (REST or GraphQL spelling). Fills only what it finds. */
export function assignmentFromObjects(candidates: Obj[]): Partial<Assignment> {
  const out: Partial<Assignment> = {};
  const fields: Array<[keyof Assignment, string[]]> = [
    ['name', ['name']],
    ['description', ['description']],
    ['due_at', ['due_at', 'dueAt']],
    ['points_possible', ['points_possible', 'pointsPossible']],
    ['html_url', ['html_url', 'htmlUrl']],
    ['submission_types', ['submission_types', 'submissionTypes']],
    ['lock_at', ['lock_at', 'lockAt']],
    ['unlock_at', ['unlock_at', 'unlockAt']],
    ['allowed_extensions', ['allowed_extensions', 'allowedExtensions']],
    ['grading_type', ['grading_type', 'gradingType']],
    ['rubric', ['rubric']],
  ];
  for (const o of candidates) {
    for (const [target, keys] of fields) {
      if (out[target] !== undefined) continue;
      const value = pick(o, ...keys);
      if (value === undefined) continue;
      // Types must match what the screens expect.
      if (target === 'description' || target === 'name' || target === 'html_url' || target === 'grading_type') {
        if (typeof value === 'string') (out as Obj)[target] = value;
      } else if (target === 'points_possible') {
        if (typeof value === 'number') out.points_possible = value;
      } else if (target === 'submission_types' || target === 'allowed_extensions') {
        if (Array.isArray(value) && value.every((x) => typeof x === 'string')) (out as Obj)[target] = value;
      } else if (target === 'rubric') {
        if (Array.isArray(value) && value.length && value.every((c) => isObj(c) && Array.isArray(c.ratings))) out.rubric = value as Assignment['rubric'];
      } else if (typeof value === 'string') {
        (out as Obj)[target] = value;
      }
    }
  }
  return out;
}

export interface CourseSummary {
  id: number;
  name: string | null;
  concluded: boolean;
}

/** The most recently captured record, in one pass (snapshots hold thousands; no copy, no sort). */
export function newestRecord(records: readonly CapturedRecord[]): CapturedRecord | undefined {
  let newest: CapturedRecord | undefined;
  for (const r of records) if (!newest || r.capturedAt > newest.capturedAt) newest = r;
  return newest;
}

/** The Canvas host to work with: the address saved in the extension, else wherever the newest capture came from. */
export function snapshotHost(snapshot: Snapshot): string | null {
  return snapshot.canvasHost ?? newestRecord(snapshot.records)?.host ?? null;
}

/** One place that knows how to find things in a snapshot. */
class Dataset {
  // Per kind, oldest first: sorted once here instead of on every lookup.
  private byKind = new Map<string, CapturedRecord[]>();

  constructor(readonly snapshot: Snapshot) {
    for (const r of snapshot.records) {
      const list = this.byKind.get(r.kind) ?? [];
      list.push(r);
      this.byKind.set(r.kind, list);
    }
    for (const list of this.byKind.values()) list.sort((a, b) => a.capturedAt - b.capturedAt);
  }

  /** Oldest first. Always a fresh array, so callers may reverse or change it. */
  of(kind: string, courseId?: number): CapturedRecord[] {
    const list = this.byKind.get(kind) ?? [];
    return courseId === undefined ? list.slice() : list.filter((r) => r.courseId === courseId);
  }

  /** Every item from every captured page of a list (paged lists are saved one page per record). */
  items(kind: string, courseId?: number): Obj[] {
    return this.of(kind, courseId).flatMap((r) => asArray(r.body));
  }

  /** Newest capture first, for picking one record ("the current submission"), where `of` is oldest first for merging. */
  newestFirst(kind: string, courseId?: number): CapturedRecord[] {
    return this.of(kind, courseId).reverse();
  }

  newest(kind: string, courseId?: number): CapturedRecord | undefined {
    const list = this.byKind.get(kind) ?? [];
    if (courseId === undefined) return list.at(-1);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].courseId === courseId) return list[i];
    return undefined;
  }

  get host(): string | null {
    return newestRecord(this.snapshot.records)?.host ?? null;
  }
}

/** Courses the student has, merged from every source the extension may have seen. Concluded ones are flagged. */
export function knownCourses(snapshot: Snapshot): CourseSummary[] {
  const ds = new Dataset(snapshot);
  const byId = new Map<number, CourseSummary>();
  const set = (id: unknown, name: unknown, concluded: boolean) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return;
    const prev = byId.get(n);
    byId.set(n, { id: n, name: typeof name === 'string' && name ? name : prev?.name ?? null, concluded });
  };

  // Weakest source first.
  for (const r of ds.of('GetUserCourses')) {
    const enrollments = asArray((r.body as { data?: { legacyNode?: { enrollments?: unknown } } })?.data?.legacyNode?.enrollments);
    for (const e of enrollments) {
      const course = isObj(e.course) ? e.course : {};
      const prev = byId.get(Number(course._id));
      const concluded = Boolean(e.concluded);
      set(course._id, course.contextName, prev ? prev.concluded && concluded : concluded);
    }
  }
  for (const c of ds.items('userCourses')) {
    if (typeof c.name !== 'string' || c.access_restricted_by_date) continue;
    const enrollments = asArray(c.enrollments);
    const concluded = c.workflow_state === 'completed' || (enrollments.length > 0 && enrollments.every((e) => e.enrollment_state === 'completed'));
    set(c.id, c.name, concluded);
  }
  for (const r of ds.of('course')) if (isObj(r.body)) set(r.body.id, r.body.name, r.body.workflow_state === 'completed');
  // Whatever the dashboard shows is current.
  for (const card of ds.items('dashboardCards')) {
    const id = card.id ?? /^course_(\d+)$/.exec(String(card.assetString ?? ''))?.[1];
    set(id, card.longName ?? card.originalName ?? card.shortName, false);
  }
  return [...byId.values()];
}

/**
 * The courses the extension works with: the ones the student chose in the app, or until they have chosen, the ones
 * on their Canvas dashboard. Null when neither is known yet (then nothing is filtered).
 */
export function pinnedIds(snapshot: Snapshot): Set<number> | null {
  if (snapshot.appPinned && snapshot.appPinned.length) return new Set(snapshot.appPinned);
  const cards = new Dataset(snapshot).newest('dashboardCards');
  if (!cards) return null;
  const ids = asArray(cards.body)
    .map((c) => Number(c.id ?? /^course_(\d+)$/.exec(String(c.assetString ?? ''))?.[1]))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? new Set(ids) : null;
}

/** Current courses, narrowed to the pinned ones once those are known. Used for coverage, freshness and upcoming work. */
export function workingCourses(snapshot: Snapshot): CourseSummary[] {
  const pinned = pinnedIds(snapshot);
  return knownCourses(snapshot).filter((c) => !c.concluded && (!pinned || pinned.has(c.id)));
}

/** "3 of 4 current courses synced", and which are missing. A course counts as synced once any course data was captured. */
export function coverage(snapshot: Snapshot) {
  const courses = workingCourses(snapshot);
  const withData = new Set(snapshot.records.filter((r) => r.courseId !== null && r.kind !== 'GetUserCourses').map((r) => r.courseId));
  const missing = courses.filter((c) => !withData.has(c.id));
  return { total: courses.length, synced: courses.length - missing.length, missing };
}

/** When a course's data was last captured (ms), or null if never. */
export function courseUpdatedAt(snapshot: Snapshot, courseId: number): number | null {
  return newestRecord(snapshot.records.filter((r) => r.courseId === courseId))?.capturedAt ?? null;
}

/** Newest capture of anything, or null. */
export function lastUpdatedAt(snapshot: Snapshot): number | null {
  return newestRecord(snapshot.records)?.capturedAt ?? null;
}

export type FreshnessKey = 'assignments' | 'grades' | 'units' | 'pages' | 'files' | 'announcements' | 'upcoming' | 'course';

export interface Freshness {
  key: FreshnessKey;
  /** When this kind of data was last captured (ms), or null if it never has been. */
  updatedAt: number | null;
  /** Older than a day. */
  stale: boolean;
  /** A type every course should have; shown as "not synced yet" when missing. The rest only appear once captured. */
  core: boolean;
}

// The captured kinds behind each thing a student recognises. `account` types are not about one course.
const FRESHNESS_TYPES: { key: FreshnessKey; kinds: string[]; core: boolean; account?: boolean }[] = [
  { key: 'assignments', kinds: ['assignments', 'assignment', 'assignmentGroups'], core: true },
  { key: 'grades', kinds: ['courseSubmissions', 'submission'], core: true },
  { key: 'units', kinds: ['modules', 'moduleItems'], core: true },
  { key: 'pages', kinds: ['pages', 'page', 'frontPage'], core: true },
  { key: 'files', kinds: ['files'], core: false },
  { key: 'announcements', kinds: ['announcements', 'discussions'], core: false },
  { key: 'upcoming', kinds: ['plannerItems', 'upcoming', 'todo', 'missingSubmissions', 'calendarEvents'], core: false, account: true },
  { key: 'course', kinds: ['course', 'userCourses', 'dashboardCards', 'GetUserCourses', 'tabs', 'enrollments', 'colors'], core: false },
];

const STALE_AFTER_MS = 24 * 3600e3;

/**
 * When each kind of data was last captured, for one course or (courseId null) across the working courses.
 * Each entry is the newest response of any kind in the group, so "grades 3 minutes ago" means a grades-bearing
 * response arrived 3 minutes ago, not that every part of it is that fresh.
 */
export function freshnessByType(snapshot: Snapshot, courseId: number | null, now: number = Date.now()): Freshness[] {
  const working = new Set(workingCourses(snapshot).map((c) => c.id));
  const inScope = (r: CapturedRecord) => (courseId !== null ? r.courseId === courseId : r.courseId === null || working.has(r.courseId));
  const out: Freshness[] = [];
  for (const type of FRESHNESS_TYPES) {
    if (courseId !== null && type.account) continue;
    const times = snapshot.records.filter((r) => type.kinds.includes(r.kind) && inScope(r)).map((r) => r.capturedAt);
    const updatedAt = times.length ? Math.max(...times) : null;
    if (!type.core && updatedAt === null) continue;
    out.push({ key: type.key, updatedAt, stale: updatedAt !== null && now - updatedAt > STALE_AFTER_MS, core: type.core });
  }
  return out;
}

/** Data kinds whose latest response from Canvas had a shape we did not expect (so the data may be stale). */
export function failingKinds(snapshot: Snapshot): string[] {
  return Object.entries(snapshot.health)
    .filter(([, h]) => h.badShape > 0 && (h.lastBadAt ?? 0) >= (h.lastOkAt ?? 0))
    .map(([kind]) => kind)
    .sort();
}

export function baseUrlOf(snapshot: Snapshot): string | null {
  const host = new Dataset(snapshot).host;
  return host ? `https://${host}` : null;
}

export function createExtensionApi(snapshot: Snapshot): CanvasApi {
  const ds = new Dataset(snapshot);
  let byId: Map<string, Obj[]> | null = null;
  const objectsWithId = (id: number | string) => (byId ??= indexById(snapshot.records)).get(String(id)) ?? [];

  // Assignments for a course: from the gradebook groups and the plain assignment list, with the student's own
  // submission attached from the submissions list.
  function groupsOf(courseId: number): AssignmentGroup[] {
    // The student's own submissions, from the submissions list; when each was captured is kept, so it can be compared
    // with a submission embedded in an assignment_groups capture of a different time.
    const submissions = new Map<number, Submission>();
    const submissionAt = new Map<number, number>();
    for (const r of ds.of('courseSubmissions', courseId)) {
      for (const s of normalizeIds(asArray(r.body))) {
        const aid = Number((s as Obj).assignment_id);
        if (!Number.isInteger(aid)) continue;
        submissions.set(aid, s as unknown as Submission); // oldest first, so the newest ends up here
        submissionAt.set(aid, r.capturedAt);
      }
    }
    const plain = new Map<number, Assignment>();
    for (const a of normalizeIds(ds.items('assignments', courseId)) as unknown as Assignment[]) plain.set(a.id, a);

    // Canvas's Assignments page and Grades page ask for the same groups with different query strings, so each is
    // saved separately and both hold the same assignments. One entry per assignment id, the newest capture winning:
    // listing them twice would also count their scores twice in the grade.
    const groups = new Map<number, AssignmentGroup>();
    const inGroup = new Map<number, Map<number, Assignment>>();
    const embeddedAt = new Map<number, number>(); // when each assignment's embedded copy was captured
    for (const r of ds.of('assignmentGroups', courseId)) {
      for (const g of normalizeIds(asArray(r.body)) as unknown as AssignmentGroup[]) {
        const mine = inGroup.get(g.id) ?? new Map<number, Assignment>();
        for (const a of g.assignments ?? []) {
          mine.set(a.id, { ...mine.get(a.id), ...a });
          embeddedAt.set(a.id, r.capturedAt);
        }
        inGroup.set(g.id, mine);
        groups.set(g.id, { ...groups.get(g.id), ...g });
      }
    }
    const finish = (a: Assignment): Assignment => {
      const embedded = a.submission ?? plain.get(a.id)?.submission;
      const listed = submissions.get(a.id);
      // Whichever was captured more recently describes the submission as it is now.
      const submission = embedded && listed ? ((embeddedAt.get(a.id) ?? 0) > (submissionAt.get(a.id) ?? 0) ? embedded : listed) : (embedded ?? listed);
      return { ...plain.get(a.id), ...a, submission };
    };
    for (const g of groups.values()) g.assignments = [...(inGroup.get(g.id)?.values() ?? [])].map(finish);
    return [...groups.values()].sort((a, b) => a.position - b.position);
  }

  function assignmentsOf(courseId: number): Assignment[] {
    const merged = new Map<number, Assignment>();
    for (const g of groupsOf(courseId)) for (const a of g.assignments ?? []) merged.set(a.id, a);
    // Assignments the plain list has but no group did (e.g. the Assignments page was visited, the Grades page was not).
    const submissionsById = new Map<number, Submission>();
    for (const s of ds.items('courseSubmissions', courseId)) submissionsById.set(Number(normalizeIds(s).assignment_id), normalizeIds(s) as unknown as Submission);
    for (const a of normalizeIds(ds.items('assignments', courseId)) as unknown as Assignment[]) {
      if (!merged.has(a.id)) merged.set(a.id, { ...a, submission: a.submission ?? submissionsById.get(a.id) });
    }
    return [...merged.values()].sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
  }

  function courseWithGrade(summary: CourseSummary): Course {
    const full =
      (ds.newest('course', summary.id)?.body as Obj | undefined) ??
      ds.items('userCourses').find((c) => Number(c.id) === summary.id) ??
      {};
    const course = normalizeIds(full) as unknown as Course;
    const groups = groupsOf(summary.id);
    const existing = course.enrollments?.find((e) => e.type === 'student');
    let enrollment: Enrollment = { type: 'student', enrollment_state: 'active', ...existing };
    // Canvas's own totals if the page carried them; otherwise worked out from the scores that were captured.
    if (existing?.computed_current_score === undefined && groups.length) {
      const model = toModel(groups);
      const result = computeGrade(model.groups, model.items, { weighted: !!course.apply_assignment_group_weights });
      enrollment = { ...enrollment, computed_current_score: result.current, computed_final_score: result.final };
    }
    return {
      ...course,
      id: summary.id,
      name: summary.name ?? course.name ?? `Course ${summary.id}`,
      enrollments: [...(course.enrollments?.filter((e) => e.type !== 'student') ?? []), enrollment],
    };
  }

  function modulesOf(courseId: number): Module[] {
    const itemsByModule = new Map<number, ModuleItem[]>();
    for (const r of ds.of('moduleItems', courseId)) {
      const mid = Number(/\/modules\/(\d+)\/items/.exec(r.url)?.[1]);
      if (Number.isInteger(mid)) {
        // One entry per item id (the same list can be captured under different query strings), newest winning.
        const merged = new Map((itemsByModule.get(mid) ?? []).map((i) => [i.id, i] as const));
        for (const item of normalizeIds(asArray(r.body)) as unknown as ModuleItem[]) merged.set(item.id, { ...merged.get(item.id), ...item });
        itemsByModule.set(mid, [...merged.values()]);
      }
    }
    const byId = new Map<number, Module>();
    for (const m of normalizeIds(ds.items('modules', courseId)) as unknown as Module[]) {
      byId.set(m.id, { ...m, items: m.items ?? itemsByModule.get(m.id) });
    }
    return [...byId.values()].sort((a, b) => a.position - b.position);
  }

  // Announcements and discussions for a course. Canvas serves them as one topic list asked two ways: with
  // only_announcements=true (the announcements page) and without (the discussions page). Which lists were captured
  // matters: a list that was never captured is "not synced", not "empty".
  function topicsOf(courseId: number) {
    const announcements = new Map<number, DiscussionTopic>();
    const discussions = new Map<number, DiscussionTopic>();
    let haveAnnouncements = false;
    let haveDiscussions = false;
    const add = (target: Map<number, DiscussionTopic>, o: Obj, isAnnouncement: boolean) => {
      const topic = normalizeIds({ ...o, is_announcement: isAnnouncement }) as unknown as DiscussionTopic;
      if (typeof topic.id === 'number' && typeof topic.title === 'string') target.set(topic.id, { ...target.get(topic.id), ...topic });
    };
    for (const r of ds.of('discussions', courseId)) {
      const asked = /[?&]only_announcements=true/.test(r.url);
      if (asked) haveAnnouncements = true;
      else haveDiscussions = true;
      for (const o of asArray(r.body)) {
        const isAnnouncement = typeof o.is_announcement === 'boolean' ? o.is_announcement : asked;
        add(isAnnouncement ? announcements : discussions, o, isAnnouncement);
      }
    }
    for (const r of ds.of('announcements')) {
      if (!r.url.includes(`course_${courseId}`)) continue; // an account-wide list, asked for this course
      haveAnnouncements = true;
      for (const o of asArray(r.body)) if (o.context_code === `course_${courseId}`) add(announcements, o, true);
    }
    const newest = (m: Map<number, DiscussionTopic>) => [...m.values()].sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
    return { announcements: newest(announcements), discussions: newest(discussions), haveAnnouncements, haveDiscussions };
  }

  function pagesOf(courseId: number): Page[] {
    const out = new Map<string, Page>();
    const add = (p: Obj) => {
      const page = normalizeIds(p) as unknown as Page;
      const key = String(page.page_id ?? page.url);
      out.set(key, { ...out.get(key), ...page });
    };
    for (const p of ds.items('pages', courseId)) add(p);
    for (const kind of ['page', 'frontPage']) for (const r of ds.of(kind, courseId)) if (isObj(r.body)) add(r.body);
    return [...out.values()];
  }

  const profile = (): UserProfile => {
    const body = ds.newest('profile')?.body;
    if (isObj(body)) return normalizeIds(body) as unknown as UserProfile;
    // No profile page was visited: the user's id still rides along on every course's enrollment.
    const course = ds.newest('course')?.body;
    const userId = isObj(course) ? asArray(course.enrollments)[0]?.user_id : undefined;
    return { id: Number(userId) || 0, name: 'Student' };
  };

  return {
    getProfile: async () => profile(),

    // Every current course, so Settings can list all of them to choose from; screens narrow it with the app's filter.
    getCourses: async () => knownCourses(snapshot).filter((c) => !c.concluded && c.name).map(courseWithGrade),

    getCourse: async (courseId) => {
      const summary = knownCourses(snapshot).find((c) => c.id === courseId);
      if (!summary) throw notSynced('This course');
      return courseWithGrade(summary);
    },

    getCourseSyllabus: needsToken,

    getAssignments: async (courseId) => assignmentsOf(courseId),

    getAssignmentGroups: async (courseId) => groupsOf(courseId),

    getModules: async (courseId) => modulesOf(courseId),

    getModuleItems: async (courseId, moduleId) => modulesOf(courseId).find((m) => m.id === moduleId)?.items ?? [],

    getPages: async (courseId: number, _loadModules?: () => Promise<Module[]>) => pagesOf(courseId),

    getPage: async (courseId, url) => {
      const page = pagesOf(courseId).find((p) => p.url === url);
      if (!page) throw notSynced('This page');
      return page;
    },

    getFile: needsToken,
    markModuleItemRead: needsToken,
    downloadFile: needsToken,

    getAnnouncements: async (courseId) => {
      const t = topicsOf(courseId);
      if (!t.haveAnnouncements) throw notSynced('Announcements');
      return t.announcements;
    },

    getDiscussions: async (courseId) => {
      const t = topicsOf(courseId);
      if (!t.haveDiscussions) throw notSynced('Discussions');
      return t.discussions;
    },

    getCourseFiles: async (courseId): Promise<CourseFile[] | null> => {
      const has = ds.of('files', courseId).length > 0;
      return has ? (normalizeIds(ds.items('files', courseId)) as unknown as CourseFile[]) : null;
    },

    getAssignment: async (courseId, assignmentId) => {
      const found = assignmentsOf(courseId).find((a) => a.id === assignmentId);
      // A visited assignment page carries the full description, which the lists do not.
      const detail = ds.newestFirst('assignment', courseId).map((r) => normalizeIds(r.body) as unknown as Assignment).find((a) => a.id === assignmentId);
      // The same assignment as it came back from a newer Canvas page (GraphQL), found by its id.
      const scavenged = assignmentFromObjects(objectsWithId(assignmentId).filter((o) => typeof o.name === 'string' || 'description' in o));
      if (!found && !detail && scavenged.name === undefined) throw notSynced('This assignment');
      const merged = { ...found, ...detail } as Assignment;
      for (const [k, v] of Object.entries(scavenged)) if ((merged as unknown as Obj)[k] == null) (merged as unknown as Obj)[k] = v;
      return merged;
    },

    getMySubmission: async (courseId, assignmentId) => {
      const detail = ds.newestFirst('submission', courseId).find((r) => Number(/\/assignments\/(\d+)\//.exec(r.url)?.[1]) === assignmentId);
      if (detail) return normalizeIds(detail.body) as unknown as Submission;
      const fromList = assignmentsOf(courseId).find((a) => a.id === assignmentId)?.submission;
      if (!fromList) throw notSynced('This submission');
      return fromList;
    },

    postSubmissionComment: needsToken,
    uploadSubmissionFile: needsToken,
    submitAssignment: needsToken,

    getUpcoming: async (): Promise<UpcomingEvent[]> => {
      const now = Date.now();
      const out: UpcomingEvent[] = [];
      for (const c of workingCourses(snapshot)) {
        for (const a of assignmentsOf(c.id)) {
          if (!a.due_at || new Date(a.due_at).getTime() < now) continue;
          if (a.submission && ['submitted', 'graded', 'pending_review'].includes(a.submission.workflow_state)) continue;
          out.push({ id: `assignment_${a.id}`, title: a.name, type: 'assignment', html_url: a.html_url, start_at: a.due_at, end_at: a.due_at, context_code: `course_${c.id}`, assignment: a });
        }
      }
      return out.sort((x, y) => (x.start_at ?? '').localeCompare(y.start_at ?? ''));
    },
  };
}

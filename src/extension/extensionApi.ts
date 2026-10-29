// A CanvasApi (the same shape createCanvasApi returns) that answers from what the browser extension captured
// instead of calling Canvas. Pages and hooks do not know the difference.
//
// What the extension has is the JSON Canvas's own pages loaded, so: ids can be strings, some lists are missing until
// the student visits that page (or runs Sync now), and anything that needs to WRITE to Canvas, or fetch a file, is not
// possible without a token. Those calls reject with a plain explanation.
import { CanvasApiError } from '../api/client';
import type { CanvasApi } from '../api/canvas';
import type { Assignment, AssignmentGroup, Conversation, ConversationMessage, Course, CourseFile, DiscussionTopic, Enrollment, MailScope, Module, ModuleItem, Page, Recipient, Submission, UpcomingEvent, UserProfile } from '../api/types';
import { computeGrade, toModel } from '../lib/grades';
import { t } from '../i18n';
import { filesForExtension, sendMessage, type CapturedRecord, type Snapshot } from './bridge';

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
// Not in the course's Canvas menu for students, so no Canvas page ever loads it for the extension to see. From the
// menu alone that cannot be told apart from "the course does not use it" (Canvas also leaves out empty tabs), so the
// message says both. Only a token (the API answers regardless of the menu) can show it. Kind 'hidden': screens show it
// as a note, not as an error.
const hiddenByCanvas = (what: string) =>
  new CanvasApiError(
    t('{what} is not in this course’s Canvas menu, so the extension cannot see it. Your school may hide it, or the course may not use it. Sign in with a Canvas token to see it.', { what }),
    403,
    'hidden',
  );

/** What the Files page loaded folder by folder (kind folderContents; older captures are kind "other" with that route). */
function folderListings(records: readonly CapturedRecord[]): CapturedRecord[] {
  return records.filter((r) => r.kind === 'folderContents' || (r.kind === 'other' && r.route === 'GET /folders/:id/all'));
}

/** The parts of a course whose Canvas tab can be hidden, and the course-menu address of each. */
export type CourseSection = 'assignments' | 'modules' | 'pages' | 'files' | 'syllabus' | 'announcements' | 'discussions' | 'quizzes' | 'people';
export const SECTION_PATHS: Record<CourseSection, string[]> = {
  assignments: ['/assignments'],
  modules: ['/modules'],
  pages: ['/pages', '/wiki'],
  files: ['/files'],
  syllabus: ['/assignments/syllabus'],
  announcements: ['/announcements'],
  discussions: ['/discussion_topics'],
  quizzes: ['/quizzes'],
  people: ['/users'],
};

/**
 * The sections Canvas's course menu does not show for this course (read from the menu on any captured course page).
 * Empty when the menu was never captured: nothing is assumed hidden.
 */
export function hiddenSections(snapshot: Snapshot, courseId: number): Set<CourseSection> {
  const nav = newestRecord(snapshot.records.filter((r) => r.kind === 'courseNav' && r.courseId === courseId));
  const tabs = isObj(nav?.body) ? asArray(nav.body.tabs) : [];
  if (!tabs.length) return new Set();
  const shown = new Set(
    tabs.map((tab) => {
      try {
        return new URL(String(tab.href), 'https://x').pathname.replace(new RegExp(`^/courses/${courseId}`), '').replace(/\/$/, '');
      } catch {
        return '';
      }
    }),
  );
  return new Set((Object.keys(SECTION_PATHS) as CourseSection[]).filter((sec) => !SECTION_PATHS[sec].some((p) => shown.has(p))));
}
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
  // Every number misread by the same factor stays in order, so also check them against what the assignment is worth
  // (with room for extra credit).
  const points = Number(pointsPossible);
  if (points > 0 && ((median as number) > points * 1.5 || (max as number) > points * 2)) return undefined;
  return stats;
}

/** Copy of `o` without the keys whose value is undefined, null or '' (so merging it never blanks a known field). */
const defined = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * Assignment groups from a captured Grades page (kind `gradesPage`, read from the page by the extension): Canvas's
 * ENV.assignment_groups (weights, drop rules, and per assignment its points, due date and omit flag), with the names
 * and links from the page's table. Shaped like the API's assignment_groups, so the grade maths reads it as is.
 */
export function gradesPageGroups(body: unknown, courseId?: number): AssignmentGroup[] {
  if (!isObj(body)) return [];
  const rows = new Map(asArray(body.assignments).map((a) => [String(a.id), a] as const));
  const groupNames = isObj(body.group_names) ? body.group_names : {};
  return asArray(body.assignment_groups).map((g, index) => {
    const assignments = asArray(g.assignments).map((a) => {
      const row = rows.get(String(a.id)) ?? {};
      return normalizeIds(
        defined({
          id: a.id,
          name: typeof row.name === 'string' ? row.name : undefined,
          html_url: row.html_url,
          points_possible: a.points_possible,
          due_at: a.due_at,
          omit_from_final_grade: a.omit_from_final_grade,
          submission_types: a.submission_types,
          assignment_group_id: g.id,
          course_id: courseId,
          score_statistics: sensibleStatistics(row.score_statistics, a.points_possible),
        }),
      ) as unknown as Assignment;
    });
    const name = groupNames[String(g.id)];
    return normalizeIds(
      defined({ id: g.id, name: typeof name === 'string' ? name : undefined, position: index + 1, group_weight: g.group_weight, rules: g.rules, assignments }),
    ) as unknown as AssignmentGroup;
  });
}

// Canvas's model names (the `<Type>_<id>` class on each module item) -> the API's module item `type`.
const MODULE_ITEM_TYPES: Record<string, string> = {
  Attachment: 'File',
  WikiPage: 'Page',
  DiscussionTopic: 'Discussion',
  Assignment: 'Assignment',
  Quiz: 'Quiz',
  'Quizzes::Quiz': 'Quiz',
  ContextModuleSubHeader: 'SubHeader',
  ExternalUrl: 'ExternalUrl',
  ContextExternalTool: 'ExternalTool',
};

/**
 * Modules from a captured Modules page (kind `modulesPage`, read from the page's HTML by the extension), in the API's
 * shape. A wiki page item carries only the page id there; `slugs` (page id -> slug) fills in its `page_url`.
 */
export function modulesFromPage(body: unknown, courseId: number, slugs: ReadonlyMap<number, string> = new Map()): Module[] {
  if (!isObj(body)) return [];
  return asArray(body.modules).map((m) => {
    const moduleId = Number(m.id);
    const items = asArray(m.items).map((it) => {
      const type = MODULE_ITEM_TYPES[String(it.canvas_type)] ?? String(it.canvas_type ?? 'SubHeader');
      const contentId = it.content_id !== undefined && type !== 'SubHeader' && type !== 'ExternalUrl' ? Number(it.content_id) : undefined;
      return defined({
        id: Number(it.id),
        module_id: moduleId,
        position: Number(it.position) || 0,
        title: typeof it.title === 'string' ? it.title : '',
        indent: Number(it.indent) || 0,
        type,
        content_id: contentId,
        html_url: it.html_url,
        external_url: type === 'ExternalUrl' || type === 'ExternalTool' ? it.external_url : undefined,
        page_url: type === 'Page' && contentId !== undefined ? slugs.get(contentId) : undefined,
      }) as unknown as ModuleItem;
    });
    return { id: moduleId, name: typeof m.name === 'string' ? m.name : '', position: Number(m.position) || 0, items, items_count: items.length } as Module;
  }).filter((m) => Number.isInteger(m.id) && m.id > 0 && courseId > 0);
}

// --- Inbox ---------------------------------------------------------------------------------------------------------

interface MailEntry {
  conversation: Conversation;
  scopes: Set<MailScope>;
  messages: Map<string, ConversationMessage>;
  at: number; // newest capture that described it
}

/** GraphQL's global ids are base64 of "<Type>-<id>" ("ConversationMessage-123"); the plain id is the number at the end. */
function plainId(v: unknown): string | null {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return null;
  if (/^\d+$/.test(v)) return v;
  try {
    return /^[A-Za-z]+-(\d+)$/.exec(atob(v))?.[1] ?? v;
  } catch {
    return v;
  }
}

const messageFrom = (m: Obj): ConversationMessage | null => {
  // The same message comes with its plain _id (a thread) or only its global id (the list): one key for both.
  const id = plainId(m._id) ?? plainId(m.id);
  const body = m.body;
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof body !== 'string') return null;
  const author = isObj(m.author) ? m.author : {};
  return {
    id: String(id),
    created_at: String(m.createdAt ?? m.created_at ?? ''),
    body,
    author_id: Number(author._id ?? m.author_id) || 0,
    ...(typeof (author.name ?? author.shortName) === 'string' ? { author_name: String(author.name ?? author.shortName).trim() } : {}),
    ...attachmentsFrom(m),
  };
};

/** A message's attachments, REST (display_name) or GraphQL (displayName, or an attachmentsConnection). */
function attachmentsFrom(m: Obj): Pick<ConversationMessage, 'attachments'> {
  const list = Array.isArray(m.attachments) ? asArray(m.attachments) : isObj(m.attachmentsConnection) ? asArray(m.attachmentsConnection.nodes) : [];
  if (!list.length) return {};
  return {
    attachments: list.map((a, i) => ({
      id: Number(plainId(a._id ?? a.id)) || -(i + 1),
      display_name: String(a.display_name ?? a.displayName ?? a.name ?? a.filename ?? '') || t('Attachment'),
      ...(typeof a.url === 'string' ? { url: a.url } : {}),
      ...(typeof (a['content-type'] ?? a.contentType) === 'string' ? { 'content-type': String(a['content-type'] ?? a.contentType) } : {}),
      ...(typeof (a.mime_class ?? a.mimeClass) === 'string' ? { mime_class: String(a.mime_class ?? a.mimeClass) } : {}),
      ...(typeof a.size === 'number' ? { size: a.size } : {}),
    })),
  };
}

/**
 * Every conversation the extension has seen: Canvas's own Inbox (GraphQL, the inbox and the sent folder, newest
 * message of each, and whole threads when one was opened) and REST-shaped answers (what the extension sent). Merged by
 * conversation id; messages by message id.
 */
export function mailFrom(records: readonly CapturedRecord[]): Map<number, MailEntry> {
  const out = new Map<number, MailEntry>();
  const entry = (id: number, at: number) => {
    let e = out.get(id);
    if (!e) {
      e = { conversation: { id, subject: null, workflow_state: 'read', last_message: null, last_message_at: null, message_count: 0, participants: [] }, scopes: new Set(), messages: new Map(), at: 0 };
      out.set(id, e);
    }
    if (at >= e.at) e.at = at;
    return e;
  };
  const addMessages = (e: MailEntry, list: unknown) => {
    for (const m of asArray(list)) {
      const msg = messageFrom(m);
      if (msg) e.messages.set(String(msg.id), { ...e.messages.get(String(msg.id)), ...msg });
    }
  };
  for (const r of [...records].sort((a, b) => a.capturedAt - b.capturedAt)) {
    const graphql = r.kind === 'other' && typeof r.route === 'string' && r.route.startsWith('POST /api/graphql');
    if (graphql) {
      const scope: MailScope = r.variables?.scope === 'sent' ? 'sent' : 'inbox';
      const listQuery = /Conversations?Query/.test(r.route ?? '') && !/Messages/.test(r.route ?? '');
      let budget = 20_000;
      const walk = (v: unknown, depth: number, state?: unknown) => {
        if (budget-- < 0 || depth > 10 || !v || typeof v !== 'object') return;
        if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1, state));
        const o = v as Obj;
        // A participant node ({ workflowState, conversation }) or a conversation node itself.
        const conv = isObj(o.conversation) && 'subject' in o.conversation ? o.conversation : o.__typename === 'Conversation' ? o : null;
        if (conv) {
          const id = Number(conv._id);
          if (Number.isInteger(id) && id > 0) {
            const e = entry(id, r.capturedAt);
            if (listQuery) e.scopes.add(scope);
            const c = e.conversation;
            if (typeof conv.subject === 'string' || conv.subject === null) c.subject = (conv.subject as string | null) ?? c.subject;
            const ws = typeof o.workflowState === 'string' ? o.workflowState : state;
            if (typeof ws === 'string') c.workflow_state = ws.toLowerCase();
            if (typeof conv.conversationMessagesCount === 'number') c.message_count = Math.max(c.message_count, conv.conversationMessagesCount);
            const people = isObj(conv.conversationParticipantsConnection) ? asArray(conv.conversationParticipantsConnection.nodes) : [];
            if (people.length) {
              c.participants = people.map((p, i) => {
                const u = isObj(p.user) ? p.user : {};
                return { id: Number(u._id) || -(i + 1), name: String(u.name ?? u.shortName ?? '').trim() };
              });
            }
            if (typeof conv.contextName === 'string') c.context_name = conv.contextName;
            if (typeof conv.contextAssetString === 'string') c.context_code = conv.contextAssetString;
            if (isObj(conv.conversationMessagesConnection)) addMessages(e, conv.conversationMessagesConnection.nodes);
          }
          return;
        }
        for (const x of Object.values(o)) walk(x, depth + 1, state);
      };
      walk(r.body, 0);
      continue;
    }
    // REST: what the extension sent (kind conversation), or an older Inbox's lists and threads.
    const rest = r.kind === 'conversation' || (r.kind === 'other' && /^GET \/conversations(\/:id)?$/.test(r.route ?? ''));
    if (!rest) continue;
    // A list says its folder (?scope=); a single conversation (a thread, or what was just sent) does not, and shows in
    // Sent anyway when the student wrote in it (see getConversations).
    const listScope: MailScope | null = /[?&]scope=sent/.test(r.url) ? 'sent' : /[?&]scope=inbox/.test(r.url) || (Array.isArray(r.body) && r.kind === 'other') ? 'inbox' : null;
    for (const original of Array.isArray(r.body) ? asArray(r.body) : isObj(r.body) ? [r.body] : []) {
      const c: Obj = { ...original }; // a copy: the snapshot's own data is never changed
      const id = Number(c.id);
      if (!Number.isInteger(id) || id <= 0 || typeof c.subject === 'undefined') continue;
      const e = entry(id, r.capturedAt);
      if (listScope) e.scopes.add(listScope);
      // In the sent folder Canvas names the student's own newest message last_authored_message(_at).
      if (listScope === 'sent' && typeof c.last_authored_message === 'string') {
        c.last_message = c.last_authored_message;
        c.last_message_at = c.last_authored_message_at;
      }
      delete c.last_authored_message;
      delete c.last_authored_message_at;
      const n = normalizeIds(c) as unknown as Conversation;
      e.conversation = { ...e.conversation, ...defined(n as unknown as Obj), participants: n.participants?.length ? n.participants : e.conversation.participants } as Conversation;
      delete e.conversation.messages;
      addMessages(e, c.messages);
    }
  }
  // Newest message and count from the messages seen.
  for (const e of out.values()) {
    const list = [...e.messages.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const c = e.conversation;
    // The people who wrote come first (as the API lists the sender first); GraphQL lists everyone in its own order.
    const authors = new Set([...e.messages.values()].map((m) => m.author_name).filter(Boolean));
    c.participants = [...c.participants].sort((a, b) => Number(authors.has(b.name)) - Number(authors.has(a.name)));
    if (list[0] && (!c.last_message_at || list[0].created_at >= c.last_message_at)) {
      c.last_message = list[0].body;
      c.last_message_at = list[0].created_at;
    }
    c.message_count = Math.max(c.message_count, list.length);
  }
  return out;
}

/** Teachers, TAs and classmates of a course, from its People page (the class list the page loaded). */
export function peopleFrom(records: readonly CapturedRecord[], courseId: number): Recipient[] {
  const out = new Map<number, Recipient>();
  for (const r of records) {
    if (r.courseId !== courseId || !(r.kind === 'enrollments' || (r.kind === 'other' && r.route === 'GET /courses/:id/users'))) continue;
    for (const o of asArray(r.body)) {
      const user = isObj(o.user) ? o.user : o;
      const roles = [...asArray(o.enrollments).map((e) => String(e.type ?? e.role ?? '')), String(o.type ?? o.role ?? '')];
      const role = roles.some((x) => /Teacher/i.test(x)) ? 'teacher' : roles.some((x) => /^Ta|TaEnrollment/i.test(x)) ? 'ta' : roles.some((x) => /Student/i.test(x)) ? 'student' : null;
      const id = Number(user.id ?? o.user_id);
      if (role && Number.isInteger(id) && typeof (user.name ?? user.short_name) === 'string') out.set(id, { id, name: String(user.name ?? user.short_name), role });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
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
    // longName is "<name> - <course code>"; the API's `name` is the card's originalName.
    set(id, card.originalName ?? card.shortName ?? card.longName, false);
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
  /** The school hides this in Canvas for the course (one course only): nothing to sync, so it is shown as hidden. */
  hidden?: boolean;
}

// The captured kinds behind each thing a student recognises. `account` types are not about one course.
// `section`: the Canvas course tab it comes from, so a tab the school hides reads "hidden in Canvas", not "not synced".
const FRESHNESS_TYPES: { key: FreshnessKey; kinds: string[]; core: boolean; account?: boolean; section?: CourseSection }[] = [
  { key: 'assignments', kinds: ['assignments', 'assignment', 'assignmentGroups', 'gradesPage'], core: true, section: 'assignments' },
  { key: 'grades', kinds: ['courseSubmissions', 'submission', 'gradesPage'], core: true },
  { key: 'units', kinds: ['modules', 'moduleItems', 'modulesPage'], core: true, section: 'modules' },
  { key: 'pages', kinds: ['pages', 'page', 'frontPage'], core: true, section: 'pages' },
  { key: 'files', kinds: ['files'], core: false, section: 'files' },
  { key: 'announcements', kinds: ['announcements', 'discussions'], core: false },
  { key: 'upcoming', kinds: ['plannerItems', 'upcoming', 'todo', 'missingSubmissions', 'calendarEvents'], core: false, account: true },
  { key: 'course', kinds: ['course', 'userCourses', 'dashboardCards', 'GetUserCourses', 'tabs', 'enrollments', 'colors', 'courseNav', 'syllabus'], core: false },
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
  const hiddenHere = courseId !== null ? hiddenSections(snapshot, courseId) : new Set<CourseSection>();
  const out: Freshness[] = [];
  for (const type of FRESHNESS_TYPES) {
    if (courseId !== null && type.account) continue;
    let updatedAt = newestRecord(snapshot.records.filter((r) => type.kinds.includes(r.kind) && inScope(r)))?.capturedAt ?? null;
    // Folder listings carry no course in their address; they count for the courses their files belong to.
    if (type.key === 'files') {
      const listed = folderListings(snapshot.records).filter((r) =>
        asArray(r.body).some((f) => {
          const id = Number(/^course_(\d+)$/.exec(String(f.context_asset_string ?? ''))?.[1]);
          return courseId !== null ? id === courseId : working.has(id);
        }),
      );
      updatedAt = Math.max(updatedAt ?? 0, newestRecord(listed)?.capturedAt ?? 0) || null;
    }
    const hidden = updatedAt === null && !!type.section && hiddenHere.has(type.section);
    if (!type.core && updatedAt === null && !hidden) continue;
    out.push({ key: type.key, updatedAt, stale: updatedAt !== null && now - updatedAt > STALE_AFTER_MS, core: type.core, ...(hidden ? { hidden } : {}) });
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
    // The Grades page's own data (window.ENV plus the names from its table), read by the extension from the page.
    // Its submissions join the list above; its groups join the gradebook groups below, in capture order.
    const fromGradesPage = ds.of('gradesPage', courseId).map((r) => ({ r, groups: gradesPageGroups(r.body, courseId) }));
    for (const r of ds.of('gradesPage', courseId)) {
      const rows = new Map(asArray(isObj(r.body) ? r.body.assignments : []).map((a) => [Number(a.id), a] as const));
      for (const s of normalizeIds(asArray(isObj(r.body) ? r.body.submissions : []))) {
        const aid = Number(s.assignment_id);
        if (!Number.isInteger(aid) || (submissionAt.get(aid) ?? 0) > r.capturedAt) continue;
        // ENV.submissions has fewer fields than the API's (no submitted_at, graded_at, late, missing): it updates what
        // it has and keeps the rest from an older capture. The row's status pill says missing / late.
        const row = rows.get(aid);
        // Only when the row says (rows captured before the pills were read have neither field: unknown, not false).
        const flags = Object.fromEntries((['missing', 'late'] as const).filter((k) => typeof row?.[k] === 'boolean').map((k) => [k, row![k]]));
        const fresh = Object.fromEntries(Object.entries({ ...s, ...flags }).filter(([, v]) => v !== undefined));
        submissions.set(aid, { ...submissions.get(aid), ...fresh } as unknown as Submission);
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
    const groupSources = [
      ...ds.of('assignmentGroups', courseId).map((r) => ({ r, groups: normalizeIds(asArray(r.body)) as unknown as AssignmentGroup[] })),
      ...fromGradesPage,
    ].sort((a, b) => a.r.capturedAt - b.r.capturedAt);
    // Each assignment counts in one group only: the one its newest capture puts it in (an assignment moved to another
    // group, then captured again, must not be counted in both).
    const latestGroup = new Map<number, number>();
    for (const { r, groups: list } of groupSources) {
      for (const g of list) {
        const mine = inGroup.get(g.id) ?? new Map<number, Assignment>();
        for (const a of g.assignments ?? []) {
          // The copy from the group it was in before carries its fields over to the group it is in now.
          const before = latestGroup.get(a.id);
          const carried = before !== undefined && before !== g.id ? inGroup.get(before)?.get(a.id) : undefined;
          mine.set(a.id, { ...carried, ...mine.get(a.id), ...a });
          latestGroup.set(a.id, g.id);
          // Only a copy that carries a submission says when that submission was seen (the Grades page's copies do not).
          if (a.submission) embeddedAt.set(a.id, r.capturedAt);
        }
        inGroup.set(g.id, mine);
        groups.set(g.id, { ...groups.get(g.id), ...g });
      }
    }
    // Planner items (loaded by the dashboard, the calendar and the course home) know when an assignment was posted and
    // Canvas's own missing / late flags, which the Grades page's data does not carry.
    const planned = new Map<number, Obj>();
    for (const item of ds.items('plannerItems')) {
      if (item.plannable_type !== 'assignment' || Number(item.course_id) !== courseId) continue;
      planned.set(Number(item.plannable_id), item);
    }
    const finish = (a: Assignment): Assignment => {
      const embedded = a.submission ?? plain.get(a.id)?.submission;
      const listed = submissions.get(a.id);
      // Whichever was captured more recently describes the submission as it is now, field by field: a newer copy with
      // fewer fields (the Grades page's) updates what it has and keeps the rest of the older one.
      const embeddedNewer = (embeddedAt.get(a.id) ?? 0) > (submissionAt.get(a.id) ?? 0);
      let submission = embedded && listed ? (embeddedNewer ? { ...listed, ...embedded } : { ...embedded, ...listed }) : (embedded ?? listed);
      const plan = planned.get(a.id);
      const plannable = isObj(plan?.plannable) ? plan.plannable : {};
      const flags = isObj(plan?.submissions) ? plan.submissions : null;
      if (flags) {
        // Only what the submission does not already say. With no submission captured at all, a bare one carrying just
        // the flags (no score or state, so the grade maths still treats it as ungraded).
        const base = submission ?? ({ assignment_id: a.id } as unknown as Submission);
        let next = base;
        if (base.missing === undefined && typeof flags.missing === 'boolean') next = { ...next, missing: flags.missing };
        if (base.late === undefined && typeof flags.late === 'boolean') next = { ...next, late: flags.late };
        if (next !== base || submission) submission = next;
      }
      const merged: Assignment = { ...plain.get(a.id), ...a, submission };
      if (merged.created_at === undefined && typeof plannable.created_at === 'string') merged.created_at = plannable.created_at;
      return merged;
    };
    for (const g of groups.values()) {
      g.assignments = [...(inGroup.get(g.id)?.values() ?? [])]
        .filter((a) => latestGroup.get(a.id) === g.id)
        .map(finish).map((a) => (a.name ? a : { ...a, name: t('Assignment {id}', { id: a.id }) }));
      // A group only seen on the Grades page has no name when it has no assignments to take it from.
      if (!g.name) g.name = t('Assignment group');
    }
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
    // The dashboard card knows the course code and the term name when the captured course record does not.
    const card = ds.items('dashboardCards').find((c) => Number(c.id ?? /^course_(\d+)$/.exec(String(c.assetString ?? ''))?.[1]) === summary.id);
    if (card) {
      if (!course.course_code && typeof card.courseCode === 'string') course.course_code = card.courseCode;
      if (!course.term && typeof card.term === 'string' && card.term) course.term = { name: card.term } as Course['term'];
    }
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
    // The Modules page draws its modules into the HTML; the extension reads them from there (kind modulesPage).
    // Weaker than the API's own lists, so those (if any were captured) win field by field.
    const fromPage = ds.newest('modulesPage', courseId)?.body;
    if (isObj(fromPage)) for (const m of modulesFromPage(fromPage, courseId, pageSlugs(courseId))) byId.set(m.id, m);
    for (const m of normalizeIds(ds.items('modules', courseId)) as unknown as Module[]) {
      byId.set(m.id, { ...byId.get(m.id), ...m, items: m.items ?? itemsByModule.get(m.id) ?? byId.get(m.id)?.items });
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
    // A discussion or announcement page opened on its own (Canvas's newer pages load it through GraphQL). Its course is
    // in the author's link (/courses/<id>/users/<id>). Fills in what the lists did not have.
    for (const r of ds.of('other')) {
      if (r.route !== 'POST /api/graphql GetDiscussionQuery') continue;
      const node = isObj(r.body) && isObj(r.body.data) && isObj(r.body.data.legacyNode) ? r.body.data.legacyNode : null;
      const author = node && isObj(node.author) ? node.author : {};
      if (!node || Number(/\/courses\/(\d+)\//.exec(String(author.htmlUrl ?? ''))?.[1]) !== courseId) continue;
      const isAnnouncement = node.isAnnouncement === true;
      const target = isAnnouncement ? announcements : discussions;
      const id = Number(node._id);
      if (!Number.isInteger(id) || target.has(id)) continue; // the list's copy is the API's own shape: keep it
      add(target, defined({ id: node._id, title: node.title, message: node.message, posted_at: node.postedAt ?? node.createdAt, html_url: `https://${r.host}/courses/${courseId}/discussion_topics/${node._id}`, author: { display_name: author.displayName } }), isAnnouncement);
      // What was opened is real, even when the list itself never was.
      if (isAnnouncement) haveAnnouncements = true;
      else haveDiscussions = true;
    }
    // The page was opened and Canvas loaded no topics for it: the course has none (that page sends no list when empty).
    const opened = (path: string) => Object.keys(snapshot.visited ?? {}).some((u) => u.replace(/\/$/, '').endsWith(`/courses/${courseId}/${path}`));
    if (!haveDiscussions && opened('discussion_topics')) haveDiscussions = true;
    if (!haveAnnouncements && opened('announcements')) haveAnnouncements = true;
    const newest = (m: Map<number, DiscussionTopic>) => [...m.values()].sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
    return { announcements: newest(announcements), discussions: newest(discussions), haveAnnouncements, haveDiscussions };
  }

  /** Wiki page id -> slug, from every captured page of the course (module items on the Modules page carry only the id). */
  function pageSlugs(courseId: number): Map<number, string> {
    const out = new Map<number, string>();
    for (const p of pagesOf(courseId)) if (p.page_id !== undefined && typeof p.url === 'string') out.set(Number(p.page_id), p.url);
    return out;
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
    // The front page first, then the pages in the order it links them (a course index usually lists its sections in
    // unit order, the order the API's list follows), then the rest as captured.
    const pages = [...out.values()];
    const front = pages.find((p) => p.front_page);
    const body = typeof front?.body === 'string' ? front.body : '';
    const at = (p: Page) => {
      if (p === front) return -1;
      const i = typeof p.url === 'string' ? body.indexOf(`/pages/${p.url}`) : -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return pages.map((p, i) => ({ p, i, at: at(p) })).sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.p);
  }

  const profile = (): UserProfile => {
    const body = ds.newest('profile')?.body;
    if (isObj(body)) return normalizeIds(body) as unknown as UserProfile;
    // Who is signed in, read from Canvas's own page (ENV.current_user): id and display name.
    const me = ds.newest('currentUser')?.body;
    if (isObj(me) && typeof me.display_name === 'string') return { id: Number(me.id) || 0, name: me.display_name, short_name: me.display_name };
    // No profile page was visited: the user's id still rides along on every course's enrollment.
    const course = ds.newest('course')?.body;
    const userId = isObj(course) ? asArray(course.enrollments)[0]?.user_id : undefined;
    return { id: Number(userId) || 0, name: 'Student' };
  };

  // The school hides this section of the course in Canvas: say so, rather than "not synced yet".
  const hidden = (courseId: number, section: CourseSection) => hiddenSections(snapshot, courseId).has(section);
  const courseNavKnown = (courseId: number) => ds.of('courseNav', courseId).length > 0;
  const sectionName: Record<CourseSection, string> = {
    assignments: t('Assignments'),
    modules: t('Units'),
    pages: t('Pages'),
    files: t('Files'),
    syllabus: t('Syllabus'),
    announcements: t('Announcements'),
    discussions: t('Discussions'),
    quizzes: t('Quizzes'),
    people: t('People'),
  };

  return {
    getProfile: async () => profile(),

    // Every current course, so Settings can list all of them to choose from; screens narrow it with the app's filter.
    // Sorted by name, as the API's /courses answers.
    getCourses: async () =>
      knownCourses(snapshot)
        .filter((c) => !c.concluded && c.name)
        .map(courseWithGrade)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),

    getCourse: async (courseId) => {
      const summary = knownCourses(snapshot).find((c) => c.id === courseId);
      if (!summary) throw notSynced('This course');
      return courseWithGrade(summary);
    },

    // From the syllabus page (ENV.SYLLABUS_BODY, read by the extension), or a course record that carried it.
    getCourseSyllabus: async (courseId) => {
      const summary = knownCourses(snapshot).find((c) => c.id === courseId);
      if (!summary) throw notSynced('This course');
      const fromPage = ds.newest('syllabus', courseId)?.body;
      const fromCourse = ds.newestFirst('course', courseId).map((r) => (isObj(r.body) ? r.body.syllabus_body : undefined)).find((b) => typeof b === 'string');
      const body = isObj(fromPage) && typeof fromPage.syllabus_body === 'string' ? fromPage.syllabus_body : fromCourse;
      if (typeof body !== 'string') throw hidden(courseId, 'syllabus') ? hiddenByCanvas(sectionName.syllabus) : notSynced(t('The syllabus'));
      return { ...courseWithGrade(summary), syllabus_body: body };
    },

    // A course whose Assignments tab is hidden still shows the assignments its Grades page lists.
    getAssignments: async (courseId) => {
      const list = assignmentsOf(courseId);
      if (!list.length && hidden(courseId, 'assignments')) throw hiddenByCanvas(sectionName.assignments);
      return list;
    },

    getAssignmentGroups: async (courseId) => groupsOf(courseId),

    getModules: async (courseId) => {
      const list = modulesOf(courseId);
      if (!list.length && hidden(courseId, 'modules')) throw hiddenByCanvas(sectionName.modules);
      return list;
    },

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
      const topics = topicsOf(courseId);
      if (!topics.haveAnnouncements) throw hidden(courseId, 'announcements') ? hiddenByCanvas(sectionName.announcements) : notSynced('Announcements');
      return topics.announcements;
    },

    getDiscussions: async (courseId) => {
      const topics = topicsOf(courseId);
      if (!topics.haveDiscussions) throw hidden(courseId, 'discussions') ? hiddenByCanvas(sectionName.discussions) : notSynced('Discussions');
      return topics.discussions;
    },

    getCourseFiles: async (courseId): Promise<CourseFile[] | null> => {
      // The API's file list, or what the Files page loaded folder by folder (each file names its course). Captures
      // from before the extension knew the folder address are kind "other" with that route.
      const fromFolders = folderListings(snapshot.records)
        .flatMap((r) => asArray(r.body))
        .filter((f) => f.context_asset_string === `course_${courseId}` && typeof f.display_name === 'string' && typeof f.size === 'number');
      const has = ds.of('files', courseId).length > 0 || fromFolders.length > 0;
      if (has) {
        const byId = new Map<number, CourseFile>();
        for (const f of normalizeIds([...fromFolders, ...ds.items('files', courseId)]) as unknown as CourseFile[]) byId.set(f.id, { ...byId.get(f.id), ...f });
        // Newest first, as the API is asked for them (sort=updated_at, order=desc).
        return [...byId.values()].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
      }
      // The course menu shows a Files tab that was never opened: not synced. Otherwise (hidden, or the menu was never
      // seen) null, exactly as the API answers a hidden Files area; the screen then lists the files found in units.
      if (courseNavKnown(courseId) && !hidden(courseId, 'files')) throw notSynced('Files');
      return null;
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

    getConversations: async (scope: MailScope) => {
      const mail = mailFrom(snapshot.records);
      if (!mail.size) throw notSynced(t('Your inbox'));
      return [...mail.values()]
        .filter((e) => e.scopes.has(scope) || (scope === 'sent' && [...e.messages.values()].some((m) => m.author_id === profile().id)))
        .map((e) => e.conversation)
        .sort((a, b) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')));
    },

    getConversation: async (id: number) => {
      const e = mailFrom(snapshot.records).get(id);
      if (!e) throw notSynced(t('This conversation'));
      return { ...e.conversation, messages: [...e.messages.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)) };
    },

    // The extension version leaves read state to Canvas (its threads are read without marking anything read).
    markConversationRead: async (id: number) => ({ id }) as unknown as Conversation,

    getUnreadCount: async () => [...mailFrom(snapshot.records).values()].filter((e) => e.scopes.has('inbox') && e.conversation.workflow_state === 'unread').length,

    // Sent through the extension, from a Canvas tab it opens in the background (the click on Send is required).
    replyToConversation: async (id: number, body: string, files: File[] = []) => {
      const sent = await sendMessage({ kind: 'reply', conversationId: id, body, ...(files.length ? { files: await filesForExtension(files) } : {}) });
      if (!sent.ok) throw new CanvasApiError(sent.error, 0, 'unknown');
      return sent.result as Conversation;
    },

    createConversation: async (m) => {
      const files = m.files?.length ? { files: await filesForExtension(m.files) } : {};
      const sent = await sendMessage({ kind: 'new', recipients: m.recipients, subject: m.subject, body: m.body, contextCode: m.contextCode, ...files });
      if (!sent.ok) throw new CanvasApiError(sent.error, 0, 'unknown');
      return (Array.isArray(sent.result) ? sent.result : [sent.result]) as Conversation[];
    },

    getCourseRecipients: async (courseId: number) => {
      const found = peopleFrom(snapshot.records, courseId);
      if (!found.length && hidden(courseId, 'people')) throw hiddenByCanvas(sectionName.people);
      return found;
    },

    postSubmissionComment: needsToken,
    uploadSubmissionFile: needsToken,
    submitAssignment: needsToken,

    // The same window as the API's /users/self/upcoming_events: due from now to a week from now.
    getUpcoming: async (): Promise<UpcomingEvent[]> => {
      const now = Date.now();
      const until = now + 7 * 24 * 3600e3;
      const out: UpcomingEvent[] = [];
      for (const c of workingCourses(snapshot)) {
        for (const a of assignmentsOf(c.id)) {
          const due = a.due_at ? new Date(a.due_at).getTime() : NaN;
          if (!(due >= now && due <= until)) continue;
          if (a.submission && ['submitted', 'graded', 'pending_review'].includes(a.submission.workflow_state)) continue;
          out.push({ id: `assignment_${a.id}`, title: a.name, type: 'assignment', html_url: a.html_url, start_at: a.due_at, end_at: a.due_at, context_code: `course_${c.id}`, assignment: a });
        }
      }
      return out.sort((x, y) => (x.start_at ?? '').localeCompare(y.start_at ?? ''));
    },
  };
}

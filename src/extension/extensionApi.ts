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
import { checkedInstant, checkedNumber, checkedStatistics, dedupeIssues, ignoreIssues, looksLikeAssignmentOf, normalizeInstant, type IssueContext, type IssueSink, type ValueIssue } from './valueChecks';

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

/** A rubric as the screens draw it: criteria, each with its ratings. */
const validRubric = (v: unknown): v is NonNullable<Assignment['rubric']> => Array.isArray(v) && v.length > 0 && v.every((c) => isObj(c) && Array.isArray(c.ratings));

/**
 * What an assignment's own page (kind `assignmentPage`) adds to an assignment known from elsewhere: only the fields
 * that are still empty. The page carries no dates (its date text is in the student's language and is never read).
 */
function fillFromPage(target: Obj, page: Obj): void {
  if (!target.name && typeof page.name === 'string' && page.name) target.name = page.name;
  if (target.points_possible == null && typeof page.points_possible === 'number') target.points_possible = page.points_possible;
  if (target.description == null && typeof page.description === 'string') target.description = page.description;
  if (target.rubric == null && validRubric(page.rubric)) target.rubric = page.rubric;
  if (!target.html_url && typeof page.html_url === 'string' && page.html_url) target.html_url = page.html_url;
}

/**
 * An assignment's dates in UTC "Z", as the API gives them, so they sort and compare with each other whatever source
 * they came from. A date that does not add up is removed (and told to `onIssue`); null stays null.
 */
function normalizeAssignmentDates(a: Obj, courseId: number, onIssue: IssueSink): void {
  for (const field of ['due_at', 'unlock_at', 'lock_at', 'created_at']) {
    if (!(field in a)) continue;
    const ctx = defined({ courseId, itemId: typeof a.id === 'number' ? a.id : undefined, item: typeof a.name === 'string' ? a.name : undefined, field }) as unknown as IssueContext;
    const v = checkedInstant(a[field], ctx, onIssue);
    if (v === undefined) delete a[field];
    else if (v !== null) a[field] = v;
  }
}

/** A date in UTC "Z" when it is one; anything else as it was (mail dates are only sorted, never dropped). */
function utc<T>(v: T): T | string {
  const r = normalizeInstant(v);
  return r.ok && r.value !== null ? r.value : v;
}

// Class statistics that make sense (moved to valueChecks.ts; still exported from here for the screens and tests).
export { sensibleStatistics } from './valueChecks';

/** Copy of `o` without the keys whose value is undefined, null or '' (so merging it never blanks a known field). */
const defined = (o: Obj): Obj => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/**
 * Assignment groups from a captured Grades page (kind `gradesPage`, read from the page by the extension): Canvas's
 * ENV.assignment_groups (weights, drop rules, and per assignment its points, due date and omit flag), with the names
 * and links from the page's table. Shaped like the API's assignment_groups, so the grade maths reads it as is.
 * Due dates come in UTC (ENV writes them with the course's offset); a value that does not add up is left out and told
 * to `onIssue`.
 */
export function gradesPageGroups(body: unknown, courseId?: number, onIssue: IssueSink = ignoreIssues): AssignmentGroup[] {
  if (!isObj(body)) return [];
  const rows = new Map(asArray(body.assignments).map((a) => [String(a.id), a] as const));
  const groupNames = isObj(body.group_names) ? body.group_names : {};
  return asArray(body.assignment_groups).map((g, index) => {
    const assignments = asArray(g.assignments).map((a) => {
      const row = rows.get(String(a.id)) ?? {};
      const name = typeof row.name === 'string' ? row.name : undefined;
      const ctx = (field: string): IssueContext => defined({ courseId, itemId: Number(a.id) || undefined, item: name, field }) as unknown as IssueContext;
      const points = checkedNumber(a.points_possible, ctx('points_possible'), onIssue);
      return normalizeIds(
        defined({
          id: a.id,
          name,
          html_url: row.html_url,
          points_possible: points,
          due_at: checkedInstant(a.due_at, ctx('due_at'), onIssue),
          omit_from_final_grade: a.omit_from_final_grade,
          submission_types: a.submission_types,
          assignment_group_id: g.id,
          course_id: courseId,
          score_statistics: checkedStatistics(row.score_statistics, points ?? undefined, ctx('score_statistics'), onIssue),
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
    // In UTC "Z" so messages from GraphQL (with an offset) and REST sort together.
    created_at: String(utc(m.createdAt ?? m.created_at ?? '')),
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
      if (typeof n.last_message_at === 'string') n.last_message_at = utc(n.last_message_at);
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
  { key: 'assignments', kinds: ['assignments', 'assignment', 'assignmentGroups', 'gradesPage', 'assignmentPage'], core: true, section: 'assignments' },
  { key: 'grades', kinds: ['courseSubmissions', 'submission', 'gradesPage'], core: true },
  { key: 'units', kinds: ['modules', 'moduleItems', 'modulesPage'], core: true, section: 'modules' },
  { key: 'pages', kinds: ['pages', 'page', 'frontPage'], core: true, section: 'pages' },
  { key: 'files', kinds: ['files'], core: false, section: 'files' },
  { key: 'announcements', kinds: ['announcements', 'discussions', 'listPage'], core: false },
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

export function createExtensionApi(snapshot: Snapshot, onIssue: IssueSink = ignoreIssues): CanvasApi {
  return extensionInternals(snapshot, onIssue).api;
}

const issuesBySnapshot = new WeakMap<Snapshot, ValueIssue[]>();

/**
 * The values Courseline left out because they did not add up (see valueChecks.ts), for the working courses: what
 * every screen would read, checked once per snapshot. Each value once.
 */
export function valueIssues(snapshot: Snapshot): ValueIssue[] {
  const cached = issuesBySnapshot.get(snapshot);
  if (cached) return cached;
  const found: ValueIssue[] = [];
  const x = extensionInternals(snapshot, (i) => found.push(i));
  const working = workingCourses(snapshot);
  for (const c of working) {
    x.assignmentsOf(c.id);
    x.topicsOf(c.id);
    x.courseWithGrade(c);
  }
  // A rubric the assignment's own page had but could not be read (the newest page of each assignment).
  const ds = new Dataset(snapshot);
  for (const c of working) {
    const newest = new Map<number, Obj>();
    for (const r of ds.of('assignmentPage', c.id)) if (isObj(r.body)) newest.set(Number(r.body.id), r.body);
    for (const [itemId, body] of newest) {
      if (body.rubric_unreadable !== true || !Number.isInteger(itemId)) continue;
      found.push({ kind: 'rubric', courseId: c.id, itemId, ...(typeof body.name === 'string' ? { item: body.name } : {}), field: 'rubric', value: null, reason: 'unreadable' });
    }
  }
  const out = dedupeIssues(found);
  issuesBySnapshot.set(snapshot, out);
  return out;
}

/**
 * The snapshot without the responses that failed their shape check (`rejectedAs`): they are kept for diagnosis only,
 * and the popup tells the student they were not used, so no reader (by kind, by route or by id) may see them.
 */
const usableBySnapshot = new WeakMap<Snapshot, Snapshot>();
export function usableSnapshot(snapshot: Snapshot): Snapshot {
  let out = usableBySnapshot.get(snapshot);
  if (!out) {
    out = snapshot.records.some((r) => r.rejectedAs) ? { ...snapshot, records: snapshot.records.filter((r) => !r.rejectedAs) } : snapshot;
    usableBySnapshot.set(snapshot, out);
  }
  return out;
}

function extensionInternals(fullSnapshot: Snapshot, onIssue: IssueSink) {
  const snapshot = usableSnapshot(fullSnapshot);
  const ds = new Dataset(snapshot);
  let byId: Map<string, Obj[]> | null = null;
  const objectsWithId = (id: number | string) => (byId ??= indexById(snapshot.records)).get(String(id)) ?? [];

  // Each assignment's own page (kind assignmentPage), by assignment id: the newest capture of each.
  function pageDetailsOf(courseId: number): Map<number, { at: number; body: Obj }> {
    const out = new Map<number, { at: number; body: Obj }>();
    for (const r of ds.of('assignmentPage', courseId)) {
      if (!isObj(r.body)) continue;
      const body = normalizeIds(r.body);
      const id = Number(body.id);
      if (Number.isInteger(id) && id > 0) out.set(id, { at: r.capturedAt, body }); // oldest first, so the newest wins
    }
    return out;
  }

  // When a score for this course was last captured: the submissions list, a submission, gradebook groups, an
  // assignment list or an assignment that carry submissions, or a Grades page.
  function newestScoreAt(courseId: number): number {
    const carriesSubmission = (r: CapturedRecord) =>
      asArray(r.body).some((x) => isObj(x.submission) || asArray(x.assignments).some((a) => isObj(a.submission)));
    const scored = [
      ...ds.of('courseSubmissions', courseId),
      ...ds.of('submission', courseId),
      ...ds.of('gradesPage', courseId),
      ...ds.of('assignmentGroups', courseId).filter(carriesSubmission),
      ...ds.of('assignments', courseId).filter(carriesSubmission),
      ...ds.of('assignment', courseId).filter((r) => isObj(r.body) && isObj(r.body.submission)),
    ];
    return newestRecord(scored)?.capturedAt ?? 0;
  }

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
    // A value that does not add up is left out of every capture, but only the newest capture of each grading period
    // reports it: an older one that a newer capture has since replaced is not the student's problem.
    const gradesPages = ds.of('gradesPage', courseId);
    const newestPerPeriod = new Map<string, CapturedRecord>();
    for (const r of gradesPages) newestPerPeriod.set(String(isObj(r.body) ? (r.body.grading_period_id ?? '') : ''), r);
    const reporting = new Set(newestPerPeriod.values());
    const sinkFor = (r: CapturedRecord): IssueSink => (reporting.has(r) ? onIssue : ignoreIssues);
    const fromGradesPage = gradesPages.map((r) => ({ r, groups: gradesPageGroups(r.body, courseId, sinkFor(r)) }));
    for (const r of gradesPages) {
      const rows = new Map(asArray(isObj(r.body) ? r.body.assignments : []).map((a) => [Number(a.id), a] as const));
      for (const s of normalizeIds(asArray(isObj(r.body) ? r.body.submissions : []))) {
        const aid = Number(s.assignment_id);
        if (!Number.isInteger(aid) || (submissionAt.get(aid) ?? 0) > r.capturedAt) continue;
        // A score that is not a number is left out (an older capture's stays); null is "not graded" and is kept.
        if ('score' in s) {
          const name = rows.get(aid)?.name;
          const score = checkedNumber(s.score, { courseId, itemId: aid, ...(typeof name === 'string' ? { item: name } : {}), field: 'score' }, sinkFor(r));
          if (score === undefined) delete s.score;
          else s.score = score;
        }
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
    // The assignment's own page fills what the lists left empty (a course whose Assignments tab is hidden has only the
    // Grades page's data: no instructions, no rubric, and no name for a row Canvas does not link).
    const pageDetails = pageDetailsOf(courseId);
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
      const page = pageDetails.get(a.id);
      if (page) fillFromPage(merged as unknown as Obj, page.body);
      const ctx = (field: string): IssueContext => ({ courseId, itemId: a.id, ...(merged.name ? { item: merged.name } : {}), field });
      if (merged.created_at === undefined && plannable.created_at !== undefined) {
        const created = checkedInstant(plannable.created_at, ctx('created_at'), onIssue);
        if (typeof created === 'string') merged.created_at = created;
      }
      // A due date no other source gave (or one that did not add up and was left out) from planner items.
      if (merged.due_at === undefined && plannable.due_at !== undefined) {
        const due = checkedInstant(plannable.due_at, ctx('due_at'), onIssue);
        if (typeof due === 'string') merged.due_at = due;
      }
      normalizeAssignmentDates(merged as unknown as Obj, courseId, onIssue);
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
      if (merged.has(a.id)) continue;
      const entry = { ...a, submission: a.submission ?? submissionsById.get(a.id) };
      normalizeAssignmentDates(entry as unknown as Obj, courseId, onIssue);
      merged.set(a.id, entry);
    }
    // Assignments only their own page knows about (opened from a link, never listed). Not in any group, so they never
    // count in the grade. The due date, if any, from planner items: the page's own date text is never read.
    const pageOnly = [...pageDetailsOf(courseId)].filter(([id]) => !merged.has(id));
    if (pageOnly.length) {
      const dueFromPlanner = new Map<number, unknown>();
      for (const item of ds.items('plannerItems')) {
        if (item.plannable_type !== 'assignment' || Number(item.course_id) !== courseId || !isObj(item.plannable)) continue;
        if (item.plannable.due_at !== undefined) dueFromPlanner.set(Number(item.plannable_id), item.plannable.due_at);
      }
      for (const [id, { body }] of pageOnly) {
        const entry: Obj = {
          id,
          course_id: courseId,
          name: body.name,
          html_url: body.html_url,
          points_possible: typeof body.points_possible === 'number' ? body.points_possible : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          rubric: validRubric(body.rubric) ? body.rubric : undefined,
          due_at: checkedInstant(dueFromPlanner.get(id), { courseId, itemId: id, ...(typeof body.name === 'string' ? { item: body.name } : {}), field: 'due_at' }, onIssue) ?? undefined,
          submission: submissionsById.get(id),
        };
        merged.set(id, Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)) as unknown as Assignment);
      }
    }
    return [...merged.values()].sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
  }

  function courseWithGrade(summary: CourseSummary): Course {
    const full =
      (ds.newest('course', summary.id)?.body as Obj | undefined) ??
      ds.items('userCourses').find((c) => Number(c.id) === summary.id) ??
      {};
    const course = normalizeIds(full) as unknown as Course;
    // The dashboard card knows the course code when the captured course record does not.
    const card = ds.items('dashboardCards').find((c) => Number(c.id ?? /^course_(\d+)$/.exec(String(c.assetString ?? ''))?.[1]) === summary.id);
    if (card && !course.course_code && typeof card.courseCode === 'string') course.course_code = card.courseCode;
    // The term: a term object first (the courses list, then Canvas's GraphQL course list), the card's text last (the
    // card can show a different label than the term's name, which is what the API gives).
    if (!course.term?.name) {
      const fromList = ds.items('userCourses').find((c) => Number(c.id) === summary.id)?.term;
      const fromGraphql = ds
        .newestFirst('GetUserCourses')
        .flatMap((r) => asArray((r.body as { data?: { legacyNode?: { enrollments?: unknown } } })?.data?.legacyNode?.enrollments))
        .map((e) => (isObj(e.course) ? e.course : {}))
        .find((c) => Number(c._id) === summary.id && isObj(c.term) && typeof c.term.name === 'string' && c.term.name);
      if (isObj(fromList) && typeof fromList.name === 'string' && fromList.name) course.term = normalizeIds(fromList) as unknown as Course['term'];
      else if (fromGraphql && isObj(fromGraphql.term)) course.term = { name: fromGraphql.term.name } as Course['term'];
      else if (card && typeof card.term === 'string' && card.term) course.term = { name: card.term } as Course['term'];
    }
    const gradesRec = ds.newest('gradesPage', summary.id);
    const page = isObj(gradesRec?.body) ? gradesRec.body : {};
    // Whether the course weights its groups: the course record's own flag, else the Grades page's ENV ("percent" is
    // weighted, "equal" is not). The Grades screen reads the same field, so both agree.
    if (typeof course.apply_assignment_group_weights !== 'boolean' && typeof page.group_weighting_scheme === 'string') {
      course.apply_assignment_group_weights = page.group_weighting_scheme === 'percent';
    }
    const groups = groupsOf(summary.id);
    const existing = course.enrollments?.find((e) => e.type === 'student');
    let enrollment: Enrollment = { type: 'student', enrollment_state: 'active', ...existing };
    // Canvas's own total: from the course record if it carried one, else as the Grades page showed it (the page with no
    // grading period chosen, or "All grading periods" (0), so the course's whole total), and only when no score was
    // captured after that page (a newer score would make its total stale). Otherwise worked out from the scores that
    // were captured, and marked as an estimate.
    if (existing?.computed_current_score === undefined && groups.length) {
      const wholeCourse = page.grading_period_id === undefined || String(page.grading_period_id) === '0';
      const current = gradesRec !== undefined && gradesRec.capturedAt >= newestScoreAt(summary.id);
      const shown = wholeCourse && current && typeof page.canvas_total === 'number' && Number.isFinite(page.canvas_total) ? page.canvas_total : undefined;
      if (shown !== undefined) {
        enrollment = { ...enrollment, computed_current_score: shown };
      } else {
        const model = toModel(groups);
        const result = computeGrade(model.groups, model.items, { weighted: !!course.apply_assignment_group_weights });
        enrollment = { ...enrollment, computed_current_score: result.current, computed_final_score: result.final, estimated: true };
      }
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
      if (typeof topic.id !== 'number' || typeof topic.title !== 'string') return;
      // In UTC "Z" (GraphQL writes an offset), so the newest-first order is right; a date that does not add up is left out.
      if ('posted_at' in topic) {
        const posted = checkedInstant(topic.posted_at, { courseId, itemId: topic.id, item: topic.title, field: 'posted_at' }, onIssue);
        if (posted === undefined) delete (topic as Partial<DiscussionTopic>).posted_at;
        else topic.posted_at = posted;
      }
      target.set(topic.id, { ...target.get(topic.id), ...topic });
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
      // An account-wide list, asked for this course (course_17 must not match course_174293).
      if (!new RegExp(`course_${courseId}(?!\\d)`).test(r.url)) continue;
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
    // "Opened" is what the landed page said (listPage: sent only when the tab really is that list, never after a
    // redirect to the course home). `visited` holds the address asked for, even when Canvas redirected, so on its own it
    // counts only when the course menu shows the tab.
    const listed = (path: string) => ds.of('listPage', courseId).some((r) => isObj(r.body) && r.body.path === path);
    const visited = (path: string) => Object.keys(snapshot.visited ?? {}).some((u) => u.replace(/\/$/, '').endsWith(`/courses/${courseId}/${path}`));
    const opened = (path: string) => listed(path) || (!hidden(courseId, path === 'announcements' ? 'announcements' : 'discussions') && visited(path));
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

  const api: CanvasApi = {
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
      // A visited assignment page carries the full description, which the lists do not: the API's detail (kind
      // assignment) where Canvas fetches it, or what the page drew on the server (kind assignmentPage) where it does not.
      const ofThis = (r: CapturedRecord) => isObj(r.body) && Number(normalizeIds(r.body).id) === assignmentId;
      const apiRec = ds.newestFirst('assignment', courseId).find(ofThis);
      const pageRec = ds.newestFirst('assignmentPage', courseId).find(ofThis);
      const apiBody = apiRec ? normalizeIds(apiRec.body as Obj) : undefined;
      const pageBody = pageRec ? normalizeIds(pageRec.body as Obj) : undefined;
      // The same assignment as it came back from a newer Canvas page (GraphQL), found by its id.
      // Ids are unique per kind only: objects that are something else (a user, a module, another course's assignment) are skipped.
      const scavenged = assignmentFromObjects(
        objectsWithId(assignmentId).filter((o) => (typeof o.name === 'string' || 'description' in o) && looksLikeAssignmentOf(o, courseId, assignmentId)),
      );
      if (!found && !apiRec && !pageRec && scavenged.name === undefined) throw notSynced('This assignment');
      const merged: Obj = { ...found, ...apiBody };
      if (pageRec && pageBody) {
        // Instructions and rubric: the page's when nothing else has them, or when it was read after the API's detail.
        const pageWins = (k: string) => merged[k] == null || !apiRec || pageRec.capturedAt > apiRec.capturedAt;
        if (typeof pageBody.description === 'string' && pageWins('description')) merged.description = pageBody.description;
        if (validRubric(pageBody.rubric) && pageWins('rubric')) merged.rubric = pageBody.rubric;
        // Title, points and link only fill gaps. The page never carries dates, so the Grades page's or API's due date stays.
        if (merged.name == null && typeof pageBody.name === 'string') merged.name = pageBody.name;
        if (merged.points_possible == null && typeof pageBody.points_possible === 'number') merged.points_possible = pageBody.points_possible;
        if (merged.html_url == null && typeof pageBody.html_url === 'string') merged.html_url = pageBody.html_url;
      }
      for (const [k, v] of Object.entries(scavenged)) if (merged[k] == null) merged[k] = v;
      // Instructions the extension did not keep because they hold a link that works without a login (a calendar feed
      // or a tool's sessionless launch): known to exist, and no later sync will bring them.
      const removed = [found, apiBody, pageBody].some((o) => isObj(o) && o.description_removed === true);
      if (typeof merged.description === 'string' && merged.description) delete merged.description_removed;
      else if (removed) merged.description_removed = true;
      // No source said what the instructions are (not even "none"): the screen says they were not synced yet.
      const saysDescription = (o: unknown) => isObj(o) && (Object.prototype.hasOwnProperty.call(o, 'description') || o.description_removed === true);
      if (![found, apiBody, pageBody].some(saysDescription) && scavenged.description === undefined) merged.instructions_unknown = true;
      normalizeAssignmentDates(merged, courseId, onIssue);
      return merged as unknown as Assignment;
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
  return { api, assignmentsOf, topicsOf, courseWithGrade };
}

// Canvas endpoints. One small function per resource; add new features here.
import { CanvasApiError, createClient, type ClientConfig } from './client';
import type { Assignment, AssignmentGroup, CourseRoster, CourseTab, Conversation, Course, CourseFile, DiscussionTopic, MailScope, Module, ModuleItem, NewMessage, Page, Quiz, QuizQuestion, QuizSubmission, Recipient, Submission, UpcomingEvent, UserProfile } from './types';

/** Students read before the People tab offers "Load everyone". */
export const STUDENTS_FIRST = 500;
/** A safety valve even for "everyone": 1,000 pages of 100. */
const PEOPLE_SAFETY_MAX = 100_000;

/** One submission's read state in Canvas (see getSubmissionReadStates). */
export interface SubmissionReadState {
  assignmentId: number;
  /** Something on it is unread in Canvas: the grade, a comment or the rubric. */
  unread: boolean;
  /** Comments not yet seen (Canvas counts 0 once the submission is read). */
  unreadComments: number;
}

const SUBMISSION_READ_STATES = `query CourselineSubmissionReadStates($courseId: ID!, $after: String) {
  course(id: $courseId) {
    submissionsConnection(first: 100, after: $after, filter: { states: [unsubmitted, submitted, pending_review, graded] }) {
      nodes { readState unreadCommentCount hasUnreadRubricAssessment assignment { _id } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export function createCanvasApi(config: ClientConfig) {
  const client = createClient(config);

  /** Message attachments go to the student's own "conversation attachments" folder, one at a time, as Canvas does. */
  async function uploadAttachments(files: File[]): Promise<string[]> {
    const ids: string[] = [];
    for (const file of files) ids.push(String((await client.uploadFile('/users/self/files', file, { parent_folder_path: 'conversation attachments' })).id));
    return ids;
  }

  const api = {
    /** Also doubles as the "is this token valid?" check at login. */
    getProfile: () => client.get<UserProfile>('/users/self/profile'),

    /**
     * Active courses the user is enrolled in, with current grades.
     *
     * - enrollment_state=active hides concluded/invited courses.
     * - include[]=total_scores puts computed_current_score/grade on each enrollment,
     *   so we get ALL grades in this single request instead of one call per course.
     * - include[]=term gives us the term name for grouping later.
     */
    getCourses: async (): Promise<Course[]> => {
      const courses = await client.getAll<Course>('/courses', {
        enrollment_state: 'active',
        include: ['total_scores', 'term'],
      });
      // QUIRK: date-restricted courses are returned as stubs with no `name`.
      return courses.filter((c) => c.name && !c.access_restricted_by_date);
    },

    getCourse: (courseId: number) =>
      client.get<Course>(`/courses/${courseId}`, { include: ['total_scores', 'term'] }),

    /** A course with its syllabus (HTML). Kept apart from getCourse because the body can be large. */
    getCourseSyllabus: (courseId: number) => client.get<Course>(`/courses/${courseId}`, { include: ['syllabus_body', 'term'] }),

    /**
     * Assignments for one course, including the user's own submission (score, status).
     * Fanning this out across every course is how you hit rate limits — only
     * fetch per course when the user opens it.
     * TODO: `bucket` param (upcoming/overdue/undated) can filter server-side.
     */
    getAssignments: (courseId: number) =>
      client.getAll<Assignment>(`/courses/${courseId}/assignments`, {
        include: ['submission'],
        order_by: 'due_at',
      }),

    /**
     * The gradebook structure: assignment groups (with weights and drop rules), each with its
     * assignments and your submission to them. One call instead of a fan-out per group.
     * score_statistics (class min/median/max) is requested too, but some Canvas installs reject it,
     * so on a plain 400 we retry without it.
     */
    getAssignmentGroups: async (courseId: number): Promise<AssignmentGroup[]> => {
      const path = `/courses/${courseId}/assignment_groups`;
      const base = { scope_assignments_to_student: true };
      try {
        return await client.getAll<AssignmentGroup>(path, { ...base, include: ['assignments', 'submission', 'score_statistics'] });
      } catch (err) {
        if (!(err instanceof CanvasApiError) || err.kind !== 'unknown') throw err;
        return client.getAll<AssignmentGroup>(path, { ...base, include: ['assignments', 'submission'] });
      }
    },

    /**
     * Course units (modules) with their items, in the instructor's order.
     * When ?include=items is passed, Canvas pre-populates the items array on each module.
     * content_details adds lock state and file size to each item.
     * QUIRK: Canvas drops `items` for modules with >50 items; this function fetches those separately.
     */
    getModules: async (courseId: number): Promise<Module[]> => {
      const modules = await client.getAll<Module>(`/courses/${courseId}/modules`, {
        include: ['items', 'content_details'],
      });
      // QUIRK: Canvas drops `items` for modules with >50 items; fetch those one by one.
      return Promise.all(
        modules.map(async (m) =>
          m.items || !m.items_count
            ? m
            : {
                ...m,
                items: await client.getAll<ModuleItem>(`/courses/${courseId}/modules/${m.id}/items`, {
                  include: ['content_details'],
                }),
              },
        ),
      );
    },

    /**
     * Items within a single module. Useful for refetching just one module's items.
     * Item types can be: "Assignment", "Page", "Discussion", "Quiz", "ExternalTool",
     * "ExternalUrl", "File", "SubHeader", etc. Some items have no content_id
     * (e.g., SubHeader section headers).
     */
    getModuleItems: (courseId: number, moduleId: number) =>
      client.getAll<ModuleItem>(`/courses/${courseId}/modules/${moduleId}/items`, {
        include: ['content_details'],
      }),

    /**
     * Wiki pages in a course, with bodies.
     * include[]=body puts every body in the list itself; pages that still come without one (block-editor
     * pages, or a Canvas that ignores the include) are fetched one by one.
     * QUIRK: many schools hide the Pages tab, which makes the /pages index 404
     * ("that page has been disabled for this course") even though individual pages
     * (/pages/:slug) still load. In that case we discover slugs ourselves: Page items
     * in modules (item.page_url) plus pages linked from the course front page.
     * `loadModules` lets the caller share a modules list it loads anyway.
     */
    getPages: async (courseId: number, loadModules: () => Promise<Module[]> = () => api.getModules(courseId)): Promise<Page[]> => {
      try {
        const list = await client.getAll<Page>(`/courses/${courseId}/pages`, { sort: 'title', include: ['body'] });
        return Promise.all(list.map((p) => (p.body !== undefined ? p : client.get<Page>(`/courses/${courseId}/pages/${p.url}`))));
      } catch (err) {
        if (!(err instanceof CanvasApiError) || !['not_found', 'forbidden'].includes(err.kind)) throw err;
      }

      const orNull = async <T,>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch (e) {
          if (e instanceof CanvasApiError && ['not_found', 'forbidden', 'unauthorized'].includes(e.kind)) return null;
          throw e;
        }
      };

      const [modules, front] = await Promise.all([orNull(loadModules()), orNull(client.get<Page>(`/courses/${courseId}/front_page`))]);
      const slugs = new Set<string>();
      for (const m of modules ?? []) for (const i of m.items ?? []) if (i.type === 'Page' && i.page_url) slugs.add(i.page_url);
      if (front?.url) slugs.add(front.url);
      for (const m of (front?.body ?? '').matchAll(/\/courses\/\d+\/pages\/([^"'?#\s<>/]+)/g)) slugs.add(decodeURIComponent(m[1]));

      const pages = await Promise.all(
        [...slugs].map(async (slug) => {
          if (slug === front?.url) return front; // already have it, body and all
          const page = await orNull(client.get<Page>(`/courses/${courseId}/pages/${slug}`));
          return page ? { ...page, url: page.url ?? slug } : null;
        }),
      );
      // Different slugs (old/renamed, case, encoding) can resolve to the same page; keep one per page.
      const seen = new Set<string>();
      return (pages.filter((p) => p !== null) as Page[]).filter((p) => {
        const id = String(p.page_id ?? p.url);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    },

    /**
     * Fetch a single wiki page's content (HTML body with embedded files/links).
     * Pages are module items of type 'Page'; this fetches the full HTML so you can
     * extract embedded files, links, etc. The url parameter is the page slug (not the full path).
     */
    getPage: (courseId: number, url: string) =>
      client.get<Page>(`/courses/${courseId}/pages/${url}`),

    /** One file's metadata, including `url`: a pre-signed download link that works without a session. */
    getFile: (fileId: number | string) => client.get<CourseFile>(`/files/${fileId}`),

    /** Marks a module item as viewed (satisfies "must view" requirements). Only matters for items that have one. */
    markModuleItemRead: (courseId: number, moduleId: number, itemId: number) =>
      client.send<unknown>('POST', `/courses/${courseId}/modules/${moduleId}/items/${itemId}/mark_read`),

    /** Bytes of a file from its signed URL (see client.getBlob). */
    downloadFile: (url: string) => client.getBlob(url),

    /**
     * Every file in the course's Files area, or null if the course hides it.
     * QUIRK: many courses disable the Files tab, which makes this 401/403 even though
     * the same files are reachable through modules — so callers must treat null as
     * "use module item links instead", not as an error.
     */
    getCourseFiles: async (courseId: number): Promise<CourseFile[] | null> => {
      try {
        return await client.getAll<CourseFile>(`/courses/${courseId}/files`, { sort: 'updated_at', order: 'desc' });
      } catch (err) {
        if (err instanceof CanvasApiError && ['forbidden', 'unauthorized', 'not_found'].includes(err.kind)) return null;
        throw err;
      }
    },

    /** One assignment with full details (description HTML, rubric, lock info). */
    /** One assignment with your submission and the class statistics (high/low/median), retried without them on a 400. */
    getAssignment: async (courseId: number, assignmentId: number) => {
      const path = `/courses/${courseId}/assignments/${assignmentId}`;
      try {
        return await client.get<Assignment>(path, { include: ['submission', 'score_statistics'] });
      } catch (err) {
        if (!(err instanceof CanvasApiError) || err.kind !== 'unknown') throw err;
        return client.get<Assignment>(path, { include: ['submission'] });
      }
    },

    /**
     * The current user's submission, with teacher comments and rubric scores.
     * `self` is an alias for the current user. QUIRK: comments/rubric_assessment are
     * only returned when explicitly included here — the `include[]=submission` on the
     * assignment endpoint doesn't carry them.
     */
    getMySubmission: (courseId: number, assignmentId: number, opts: { history?: boolean } = {}) =>
      client.get<Submission>(`/courses/${courseId}/assignments/${assignmentId}/submissions/self`, {
        include: ['submission_comments', 'rubric_assessment', ...(opts.history ? ['submission_history'] : [])],
      }),

    // --- Quizzes (classic only; New Quizzes are an external tool with no student API) ---------------------------

    getQuizzes: (courseId: number) => client.getAll<Quiz>(`/courses/${courseId}/quizzes`),

    /** The student's own submission to a quiz (Canvas answers with just theirs). */
    getMyQuizSubmissions: async (courseId: number, quizId: number): Promise<QuizSubmission[]> =>
      (await client.get<{ quiz_submissions?: QuizSubmission[] }>(`/courses/${courseId}/quizzes/${quizId}/submissions`)).quiz_submissions ?? [],

    /**
     * The questions as they were in one attempt, with the answers' weights (which ones are right) when Canvas
     * lets the student see them. Many schools refuse this to students; getQuizSubmissionQuestions is the fallback.
     */
    getQuizQuestionsForAttempt: (courseId: number, quizId: number, quizSubmissionId: number, attempt: number) =>
      client.getAll<QuizQuestion>(`/courses/${courseId}/quizzes/${quizId}/questions`, { quiz_submission_id: quizSubmissionId, quiz_submission_attempt: attempt }),

    /** The questions of the student's quiz submission, each with the answer they gave (no weights). */
    getQuizSubmissionQuestions: async (quizSubmissionId: number): Promise<QuizQuestion[]> => {
      const res = await client.get<{ quiz_submission_questions?: (QuizQuestion & { quiz_question?: QuizQuestion })[] }>(`/quiz_submissions/${quizSubmissionId}/questions`, {
        include: ['quiz_question'],
      });
      // Depending on the Canvas version the question comes merged in or nested under quiz_question.
      return (res.quiz_submission_questions ?? []).map(({ quiz_question, ...q }) => ({ ...quiz_question, ...q, id: q.id ?? quiz_question?.id }) as QuizQuestion);
    },

    /**
     * Post a comment on your own submission (what the Reply box does). Students are
     * allowed to comment on their own submissions, even before submitting anything.
     * QUIRK: the user id must be the real id; `self` isn't accepted on this PUT.
     */
    // --- Inbox ---------------------------------------------------------------------------------------------------

    /** The inbox or the sent folder, newest activity first. */
    getConversations: async (scope: MailScope) => {
      // QUIRK: in the sent folder Canvas describes your own newest message as last_authored_message(_at) and may leave
      // last_message(_at) empty; the list wants one pair either way.
      const list = await client.getAll<Conversation & { last_authored_message?: string | null; last_authored_message_at?: string | null }>('/conversations', { scope, per_page: 50 });
      return list.map(({ last_authored_message, last_authored_message_at, ...c }) =>
        scope === 'sent' ? { ...c, last_message: last_authored_message ?? c.last_message, last_message_at: last_authored_message_at ?? c.last_message_at } : c,
      );
    },

    /** One conversation with its whole thread (newest message first). Opening it marks it read, as in Canvas. */
    getConversation: (id: number) => client.get<Conversation>(`/conversations/${id}`),

    /** Mark a conversation read (opening it with GET already does; this makes sure, and says so at once). */
    markConversationRead: (id: number) => client.send<Conversation>('PUT', `/conversations/${id}`, { conversation: { workflow_state: 'read' } }),

    /** Unread conversations in the inbox (Canvas sends the number as a string). */
    getUnreadCount: async () => Number((await client.get<{ unread_count: string | number }>('/conversations/unread_count')).unread_count) || 0,

    /** Reply in a conversation (files are uploaded first); Canvas answers with the conversation and the new message. */
    replyToConversation: async (id: number, body: string, files: File[] = []) => {
      const attachmentIds = await uploadAttachments(files);
      return client.send<Conversation>('POST', `/conversations/${id}/add_message`, { body, ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}) });
    },

    /** Start a conversation. Several recipients get one shared conversation (group_conversation), as in Canvas. */
    createConversation: async (m: NewMessage) => {
      const attachmentIds = await uploadAttachments(m.files ?? []);
      return client.send<Conversation[]>('POST', '/conversations', {
        recipients: m.recipients.map(String),
        subject: m.subject,
        body: m.body,
        group_conversation: true,
        ...(m.contextCode ? { context_code: m.contextCode } : {}),
        ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}),
      });
    },

    /** A course's teachers and TAs, for New message: always few, so read in full. */
    getCourseStaff: async (courseId: number): Promise<Recipient[]> => {
      const users = await client.getAll<{ id: number; name: string; enrollments?: Array<{ type: string }> }>(`/courses/${courseId}/users`, {
        enrollment_type: ['teacher', 'ta'],
        include: ['enrollments'],
      });
      return users.map((u) => ({ id: u.id, name: u.name, role: u.enrollments?.some((e) => e.type === 'TeacherEnrollment') ? 'teacher' : 'ta' }));
    },

    /**
     * Some of a course's students, for New message, without reading a class that can be thousands long: Canvas's own
     * name search (`term`, which Canvas needs to be two characters or more), the ones among `userIds`, or else the first
     * by name. One request, at most `limit` people.
     */
    findClassmates: async (courseId: number, q: { term?: string; userIds?: number[]; limit?: number }): Promise<Recipient[]> => {
      const limit = q.limit ?? 30;
      const term = q.term?.trim();
      if (q.userIds && !q.userIds.length) return [];
      const { items } = await client.getUpTo<{ id: number; name: string }>(
        `/courses/${courseId}/users`,
        {
          enrollment_type: ['student'],
          ...(term && term.length >= 2 ? { search_term: term } : {}),
          ...(q.userIds ? { user_ids: q.userIds.map(String) } : {}),
          per_page: Math.min(limit, 100),
        },
        limit,
        1,
      );
      return items.map((u) => ({ id: u.id, name: u.name, role: 'student' }));
    },

    /** Who the student can write to about a course: its teachers, TAs and classmates (the course's class list). */
    getCourseRecipients: async (courseId: number): Promise<Recipient[]> => {
      const users = await client.getAll<{ id: number; name: string; enrollments?: Array<{ type: string }> }>(`/courses/${courseId}/users`, {
        enrollment_type: ['teacher', 'ta', 'student'],
        include: ['enrollments'],
      });
      const roleOf = (u: (typeof users)[number]) => {
        const types = u.enrollments?.map((e) => e.type) ?? [];
        return types.includes('TeacherEnrollment') ? 'teacher' : types.includes('TaEnrollment') ? 'ta' : 'student';
      };
      return users.map((u) => ({ id: u.id, name: u.name, role: roleOf(u) }));
    },

    /**
     * Everyone in a course (teachers, TAs, students), for its People tab: teachers first, then by name. Email and
     * student id (sis_user_id, else login_id) come only when this Canvas lets students see them; many do not (the
     * school's permissions read_sis / view_user_logins), and then they are simply absent.
     */
    /**
     * A course's teachers, TAs and students. A university-wide course can have tens of thousands of students, so unless
     * `everyone` is set only the first STUDENTS_FIRST students are read (`more` says Canvas has others). Teachers and
     * TAs are read apart and always in full, so they are never the ones cut off.
     */
    getCoursePeople: async (courseId: number, everyone = false): Promise<CourseRoster> => {
      type User = { id: number; name: string; sortable_name?: string; avatar_url?: string; email?: string; login_id?: string; sis_user_id?: string; enrollments?: Array<{ type: string }> };
      const path = `/courses/${courseId}/users`;
      const include = ['enrollments', 'email', 'avatar_url'];
      const [staff, students] = await Promise.all([
        client.getAll<User>(path, { enrollment_type: ['teacher', 'ta'], include }),
        client.getUpTo<User>(path, { enrollment_type: ['student'], include }, everyone ? PEOPLE_SAFETY_MAX : STUDENTS_FIRST),
      ]);
      const roleOf = (types: string[]) => (types.includes('TeacherEnrollment') ? 'teacher' : types.includes('TaEnrollment') ? 'ta' : 'student');
      const rank = { teacher: 0, ta: 1, student: 2 } as Record<string, number>;
      // Someone in both lists (a TA who is also enrolled as a student) is listed once, by their staff role.
      const byId = new Map<number, User>();
      for (const u of [...students.items, ...staff]) byId.set(u.id, { ...u, enrollments: [...(byId.get(u.id)?.enrollments ?? []), ...(u.enrollments ?? [])] });
      const people = [...byId.values()]
        .map((u) => ({
          id: u.id,
          name: u.name,
          role: roleOf(u.enrollments?.map((e) => e.type) ?? []),
          sortable: u.sortable_name ?? u.name,
          ...(u.avatar_url ? { avatar_url: u.avatar_url } : {}),
          ...(u.email ? { email: u.email } : {}),
          ...(u.sis_user_id || u.login_id ? { student_id: u.sis_user_id || u.login_id } : {}),
        }))
        .sort((a, b) => rank[a.role] - rank[b.role] || a.sortable.localeCompare(b.sortable))
        .map(({ sortable: _sortable, ...p }) => p);
      return { people, complete: !students.more, more: students.more };
    },

    // --- Read state (what Canvas shows as unread) ------------------------------------------------------------------

    /**
     * Canvas's read state of every submission of the student's in a course: unread when a grade, comment or rubric
     * score came in that the student has not looked at. GraphQL, because REST gives a submission's read_status only by
     * marking it read. A student is answered with their own submissions only. Paged by 100.
     */
    getSubmissionReadStates: async (courseId: number): Promise<SubmissionReadState[]> => {
      type Page = {
        course: {
          submissionsConnection: {
            nodes: { readState?: string | null; unreadCommentCount?: number | null; hasUnreadRubricAssessment?: boolean | null; assignment?: { _id: string } | null }[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          } | null;
        } | null;
      };
      const out: SubmissionReadState[] = [];
      let after: string | null = null;
      for (let page = 0; page < 50; page++) {
        const data: Page = await client.graphql<Page>(SUBMISSION_READ_STATES, { courseId: String(courseId), after });
        const conn = data.course?.submissionsConnection;
        if (!conn) break;
        for (const n of conn.nodes) {
          const id = Number(n.assignment?._id);
          if (!Number.isInteger(id)) continue;
          const unreadComments = n.unreadCommentCount ?? 0;
          out.push({ assignmentId: id, unread: n.readState === 'unread' || unreadComments > 0 || !!n.hasUnreadRubricAssessment, unreadComments });
        }
        if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
        after = conn.pageInfo.endCursor;
      }
      return out;
    },

    /**
     * Marks the student's submission read in Canvas (grade, comments and rubric: the dot in Canvas goes too), then its
     * comments as viewed, which Canvas counts apart and an older Canvas may not know (that second step may fail quietly).
     * QUIRK: needs the real user id, like the comment PUT.
     */
    markSubmissionRead: async (courseId: number, assignmentId: number, userId: number) => {
      const path = `/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}/read`;
      await client.send<void>('PUT', path);
      await client.send<void>('PUT', `${path}/comment`).catch(() => {});
    },

    /** Marks an announcement or discussion read in Canvas, as opening it there does. */
    markTopicRead: (courseId: number, topicId: number) => client.send<void>('PUT', `/courses/${courseId}/discussion_topics/${topicId}/read`),

    postSubmissionComment: (courseId: number, assignmentId: number, userId: number, text: string) =>
      client.send<Submission>('PUT', `/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`, {
        comment: { text_comment: text },
      }),

    /** Upload one file for a submission (all three steps); returns the new file's id. Pass the ids to submitAssignment. */
    uploadSubmissionFile: (courseId: number, assignmentId: number, file: File) =>
      client.uploadFile(`/courses/${courseId}/assignments/${assignmentId}/submissions/self/files`, file),

    /**
     * Upload an image or document to put in a text entry, into your files' "Uploaded Media" folder, as Canvas's editor
     * does. Returns the file (its `uuid` is the verifier the embedded address needs).
     */
    uploadEditorFile: (file: File) => client.uploadFile('/users/self/files', file, { parent_folder_path: 'Uploaded Media' }),

    /** Submit an assignment via text entry or file upload. */
    submitAssignment: (
      courseId: number,
      assignmentId: number,
      submission: { submission_type: string; body?: string; file_ids?: number[] }
    ) =>
      client.send<Submission>('POST', `/courses/${courseId}/assignments/${assignmentId}/submissions`, {
        submission,
      }),

    /**
     * Upcoming assignments + calendar events across all courses in one call.
     * Cheaper than per-course assignment fetches for the dashboard.
     * QUIRK: returns events too (type 'event'); we keep only type 'assignment'.
     * QUIRK: this endpoint isn't paginated the same way and may include
     * already-submitted work; check assignment.submission if you add that include.
     */
    getUpcoming: async (): Promise<UpcomingEvent[]> => {
      const events = await client.get<UpcomingEvent[]>('/users/self/upcoming_events');
      return events.filter((e) => e.type === 'assignment' && e.assignment);
    },

    /**
     * Announcements for one course. QUIRK: the account-wide /announcements endpoint only returns a window around today
     * (two weeks back, four ahead) unless dates are given, so older ones would silently vanish; the course's own
     * topic list with only_announcements has no such window.
     */
    getAnnouncements: (courseId: number) =>
      client.getAll<DiscussionTopic>(`/courses/${courseId}/discussion_topics`, { only_announcements: true, order_by: 'recent_activity' }),

    /** The course's Canvas menu as the student sees it: what the school hides is left out, external tools included. */
    getCourseTabs: async (courseId: number): Promise<CourseTab[]> =>
      (await client.getAll<CourseTab>(`/courses/${courseId}/tabs`)).filter((tab) => !tab.hidden).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),

    /** Discussion topics for one course (Canvas leaves announcements out of this list). */
    getDiscussions: (courseId: number) => client.getAll<DiscussionTopic>(`/courses/${courseId}/discussion_topics`, { order_by: 'recent_activity' }),

    // TODO(discussions): /discussion_topics/:id/view for threaded replies
    // TODO(calendar): GET /calendar_events?start_date=&end_date=&context_codes[]=
    // TODO(folders): GET /courses/:id/folders for a folder-tree view of files
    // TODO(inbox): GET /conversations
  };
  return api;
}

export type CanvasApi = ReturnType<typeof createCanvasApi>;

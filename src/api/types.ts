// Minimal Canvas API types — only the fields this app reads.
// Canvas responses contain many more fields; add them here as you need them.
// Reference: https://canvas.instructure.com/doc/api/

// QUIRK: Canvas IDs are JSON numbers, but they are 64-bit and in some sharded
// installs can exceed Number.MAX_SAFE_INTEGER (cross-shard IDs look like
// "10000000000123"). If you ever see IDs mangled, send the header
// `Accept: application/json+canvas-string-ids` to get them as strings.
export type CanvasId = number;

export interface UserProfile {
  id: CanvasId;
  name: string;
  short_name?: string;
  primary_email?: string;
  avatar_url?: string;
}

export interface Enrollment {
  type: 'student' | 'teacher' | 'ta' | 'observer' | 'designer' | string;
  enrollment_state: string;
  // QUIRK: these only appear when you request include[]=total_scores, and are
  // null when the instructor hides totals or no work has been graded yet.
  computed_current_score?: number | null; // percent, based on graded work only
  computed_final_score?: number | null; // percent, ungraded work counts as 0
  computed_current_grade?: string | null; // letter grade, if the course uses a scheme
  computed_final_grade?: string | null;
}

export interface Term {
  id: CanvasId;
  name: string;
}

export interface Course {
  id: CanvasId;
  // QUIRK: courses restricted by date (e.g. a past term) come back WITHOUT a
  // name and with access_restricted_by_date: true. We filter those out.
  name?: string;
  course_code?: string;
  workflow_state?: string;
  access_restricted_by_date?: boolean;
  term?: Term; // include[]=term
  // Whether the instructor weights assignment groups (vs. a plain points total).
  apply_assignment_group_weights?: boolean;
  enrollments?: Enrollment[]; // present on /users/self/courses
}

export interface SubmissionComment {
  id: CanvasId;
  author_id?: CanvasId;
  author_name: string;
  comment: string; // plain text
  created_at: string;
  attachments?: FileAttachment[];
}

export interface FileAttachment {
  id: CanvasId;
  display_name: string;
  url: string; // pre-signed (includes a verifier), so it opens without a session
  size?: number;
}

export interface Submission {
  workflow_state: 'unsubmitted' | 'submitted' | 'graded' | 'pending_review' | string;
  score?: number | null;
  grade?: string | null;
  submitted_at?: string | null;
  graded_at?: string | null;
  attempt?: number | null;
  late?: boolean;
  missing?: boolean;
  excused?: boolean | null;
  body?: string | null; // online_text_entry submissions (HTML)
  url?: string | null; // online_url submissions
  attachments?: FileAttachment[]; // online_upload submissions
  // Only present with include[]=submission_comments / rubric_assessment on the submission endpoint.
  submission_comments?: SubmissionComment[];
  rubric_assessment?: Record<string, { points?: number; comments?: string; rating_id?: string }>;
}

export interface RubricRating {
  id: string;
  description: string;
  long_description?: string;
  points: number;
}

export interface RubricCriterion {
  id: string; // keys rubric_assessment
  description: string;
  long_description?: string;
  points: number;
  ratings: RubricRating[];
}

export interface Assignment {
  id: CanvasId;
  course_id: CanvasId;
  name: string;
  // QUIRK: due_at is null for assignments with no due date. It is also the
  // *default* due date; per-section/student overrides live in `all_dates`.
  due_at: string | null; // ISO 8601, UTC
  points_possible: number | null;
  html_url: string;
  submission_types?: string[];
  has_submitted_submissions?: boolean;
  // QUIRK: `description` is instructor-authored HTML. Never inject it unsanitized
  // (see components/HtmlContent.tsx). Links/images inside are often root-relative.
  description?: string | null;
  grading_type?: string;
  unlock_at?: string | null;
  lock_at?: string | null;
  locked_for_user?: boolean;
  lock_explanation?: string; // HTML
  allowed_extensions?: string[];
  rubric?: RubricCriterion[]; // only present when the assignment has a rubric
  submission?: Submission; // include[]=submission (only for the current user)
  assignment_group_id?: CanvasId;
  omit_from_final_grade?: boolean;
  // include[]=score_statistics (needs include[]=submission); absent when the instructor hides distributions.
  score_statistics?: ScoreStatistics;
}

export interface ScoreStatistics {
  min: number;
  max: number;
  mean: number;
  lower_q?: number;
  median: number;
  upper_q?: number;
}

// A gradebook category ("Homework 30%"). Returned with its assignments (and your submissions) inline.
export interface AssignmentGroup {
  id: CanvasId;
  name: string;
  position: number;
  group_weight: number | null; // percent; only meaningful when the course applies group weights
  rules?: { drop_lowest?: number; drop_highest?: number; never_drop?: CanvasId[] };
  assignments?: Assignment[];
}

export interface ModuleItem {
  id: CanvasId;
  module_id: CanvasId;
  position: number;
  title: string;
  indent?: number; // nesting level inside the unit
  type: 'File' | 'Page' | 'Discussion' | 'Assignment' | 'Quiz' | 'SubHeader' | 'ExternalUrl' | 'ExternalTool' | string;
  content_id?: CanvasId; // id of the underlying file/assignment/etc. (absent for SubHeader/ExternalUrl)
  html_url?: string; // opens the item inside Canvas
  external_url?: string; // ExternalUrl items
  page_url?: string; // Page items: the wiki page slug (html_url points at /modules/items/:id, NOT the page)
  content_details?: { locked_for_user?: boolean; size?: number; due_at?: string | null };
}

// A Canvas "module" is what instructors use as a unit/week/chapter.
export interface Module {
  id: CanvasId;
  name: string;
  position: number;
  state?: 'locked' | 'unlocked' | 'started' | 'completed';
  unlock_at?: string | null;
  items_count?: number;
  // QUIRK: `items` is omitted when a module has more than 50 items; getModules() fetches those separately.
  items?: ModuleItem[];
}

export interface CourseFile {
  id: CanvasId;
  display_name: string;
  filename: string;
  url: string; // download URL, pre-signed with a verifier so it works without a session
  size: number; // bytes
  'content-type'?: string;
  updated_at?: string;
  locked?: boolean;
  hidden?: boolean;
}

// /users/self/upcoming_events returns a mix of assignments and calendar events.
export interface UpcomingEvent {
  id: string | number; // string like "assignment_123" for assignments
  title: string;
  type: 'assignment' | 'event' | string;
  html_url: string;
  start_at: string | null;
  end_at: string | null;
  context_code?: string; // "course_123" | "user_456" | "group_789"
  assignment?: Assignment;
}

// Page content (HTML) with embedded files and links.
export interface Page {
  page_id?: CanvasId;
  url?: string; // the slug, not the full path
  html_url?: string; // opens the page inside Canvas
  title?: string;
  body?: string; // HTML content, may contain embedded files/links
  created_at?: string;
  updated_at?: string;
}

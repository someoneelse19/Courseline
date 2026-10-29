// Which Canvas pages to open to refresh something, as a list of steps the extension opens one at a time in
// background tabs. Pure, so it is easy to test. (The page lists mirror what each kind of data comes from.)
import { SECTION_PATHS, type CourseSection, type FreshnessKey } from './extensionApi';
import type { PullStep } from './bridge';
import { t } from '../i18n';

export type Depth = 'essential' | 'everything';

// The pages the app's own screens are built from. The course home carries the front page and the course menu (which
// tabs the school shows); the Grades page carries the assignments, weights and scores in the page itself.
const COURSE_PAGES: Array<[string, string]> = [
  ['', 'Home'],
  ['assignments', 'Assignments'],
  ['grades', 'Grades'],
  ['modules', 'Units'],
  ['pages', 'Pages'],
  // Files by unit needs both the units and the file list (sizes, dates, files outside units).
  ['files', 'Files'],
];

// Everything else a course has; opening them makes Canvas's own pages request their data.
const EXTRA_COURSE_PAGES: Array<[string, string]> = [
  ['announcements', 'Announcements'],
  ['discussion_topics', 'Discussions'],
  ['quizzes', 'Quizzes'],
  ['assignments/syllabus', 'Syllabus'],
  ['users', 'People'],
];

// Not about one course. Opened once per run.
const ACCOUNT_PAGES: Array<[string, string]> = [
  ['courses', 'All courses'],
  ['grades', 'All grades'],
  ['calendar', 'Calendar'],
  ['conversations', 'Inbox'],
  // Message threads and the sent folder are read when the student opens Messages in the app, not here.
];

export interface CourseRef {
  id: number;
  name: string | null;
  /** Course tabs the school hides in Canvas (see hiddenSections). Their pages only redirect home, so they are skipped. */
  hidden?: ReadonlySet<CourseSection>;
}

/** Is this course page one the school hides? (Its address is the tab's, or under it, like assignments/syllabus.) */
function isHidden(course: CourseRef, path: string): boolean {
  if (!course.hidden?.size || !path) return false;
  return [...course.hidden].some((section) => SECTION_PATHS[section].includes(`/${path}`));
}

const courseName = (c: CourseRef) => c.name ?? t('Course {id}', { id: c.id });

export const dashboardStep = (host: string): PullStep => ({ url: `https://${host}/`, label: t('Dashboard') });

/** The whole sync: account pages once (with "everything"), then each course's pages. The dashboard is added by the caller. */
export function planSync(host: string, courses: CourseRef[], depth: Depth = 'everything'): PullStep[] {
  const steps: PullStep[] = [];
  if (depth === 'everything' && courses.length) {
    for (const [path, label] of ACCOUNT_PAGES) steps.push({ url: `https://${host}/${path}`, label: t(label) });
  }
  for (const c of courses) steps.push(...planCourse(host, c, depth));
  return steps;
}

export function planCourse(host: string, course: CourseRef, depth: Depth = 'everything'): PullStep[] {
  const pages = (depth === 'everything' ? [...COURSE_PAGES, ...EXTRA_COURSE_PAGES] : COURSE_PAGES).filter(([path]) => !isHidden(course, path));
  return pages.map(([path, label]) => ({ url: `https://${host}/courses/${course.id}${path ? `/${path}` : ''}`, label: `${courseName(course)} · ${t(label)}` }));
}

// The pages that make Canvas load each kind of data shown in the status bar, first choice first. When a course's own
// tab for it is hidden, the next page that still carries it is used (the Grades page lists the assignments; the course
// home has the front page).
const KIND_PAGES: Record<FreshnessKey, { course: string[]; account: string | null }> = {
  assignments: { course: ['assignments', 'grades'], account: null },
  grades: { course: ['grades'], account: 'grades' },
  units: { course: ['modules'], account: null },
  pages: { course: ['pages', ''], account: null },
  files: { course: ['files'], account: null },
  announcements: { course: ['announcements'], account: null },
  upcoming: { course: [], account: 'calendar' },
  course: { course: [''], account: '' },
};

/** The page(s) that refresh one kind of data, for one course or (courseId null) the account. Empty if there is none. */
export function stepsForKind(host: string, course: CourseRef | null, key: FreshnessKey, label: string): PullStep[] {
  const target = KIND_PAGES[key];
  if (course) {
    const path = target.course.find((p) => !isHidden(course, p));
    if (path === undefined) return [];
    return [{ url: `https://${host}/courses/${course.id}${path ? `/${path}` : ''}`, label: `${courseName(course)} · ${label}` }];
  }
  if (target.account === null) return [];
  return [{ url: `https://${host}/${target.account}`, label }];
}

export type AddressResult = { ok: true; step: PullStep } | { ok: false; error: string };

/**
 * Turns what a student typed or pasted (a full Canvas address, or just a path like /courses/12/grades) into one
 * step on their own Canvas. Anything on another host, or not https, is refused.
 */
export function stepForAddress(host: string, input: string): AddressResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Paste a Canvas page address.' };
  let url: URL;
  try {
    url = raw.startsWith('/') ? new URL(raw, `https://${host}`) : new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'That does not look like a web address.' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Canvas pages use https.' };
  if (url.host.toLowerCase() !== host.toLowerCase()) return { ok: false, error: `That page is not on your Canvas address (${host}).` };
  if (url.username || url.password) return { ok: false, error: 'Leave out any user name or password.' };
  return { ok: true, step: { url: url.href, label: `${url.pathname}${url.search}` } };
}

/** Background tabs loading at once (the extension's CONCURRENCY in extension/lib/pullRunner.js). */
export const TABS_AT_ONCE = 4;

/** Rough time for a run. Each page moves on as soon as it has loaded, so this is mostly Canvas's own load time. */
export function estimateSeconds(stepCount: number): number {
  return Math.round((Math.ceil(stepCount / TABS_AT_ONCE) || 0) * 4);
}

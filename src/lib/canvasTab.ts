// Canvas's external tools (attendance, New Quizzes, …) cannot be shown inside Courseline: every Canvas page is sent with
// `frame-ancestors` limited to the school's own Canvas hosts (checked on the owner's school, Nov 19, 2026), and a tool
// can only be reached through Canvas's launch. So they open in a new tab, with Canvas's `display=borderless` (no Canvas
// menus: the tool fills the page).
import type { Assignment, CourseTab } from '../api/types';

/** The same address with display=borderless. Relative addresses are made absolute on `base` (the Canvas address). */
export function borderlessUrl(url: string, base?: string): string {
  const u = new URL(url, base);
  u.searchParams.set('display', 'borderless');
  return u.toString();
}

/** Opens a Canvas page in a new tab. False when the browser blocked it. */
export function openCanvasTab(url: string, base?: string): boolean {
  const tab = window.open(borderlessUrl(url, base), '_blank');
  if (!tab) return false;
  tab.opener = null; // the tool's page gets no handle on Courseline
  return true;
}

/** A quiz: classic (online_quiz) or New Quizzes (an external tool Canvas marks as a quiz). */
export const isQuiz = (a: Pick<Assignment, 'submission_types' | 'is_quiz_lti_assignment'>) => !!a.is_quiz_lti_assignment || !!a.submission_types?.includes('online_quiz');

/** Done in an external tool (a New Quiz, an interactive activity…), not by uploading or typing. */
export const isToolAssignment = (a: Pick<Assignment, 'submission_types' | 'is_quiz_lti_assignment'>) => isQuiz(a) || !!a.submission_types?.includes('external_tool');

/** The course's external tools, from its Canvas menu. */
export const externalTools = (tabs: readonly CourseTab[]) => tabs.filter((tab) => tab.type === 'external');

/** An attendance tool, by its name (the school's is "Asistencia"). */
export const isAttendanceTool = (label: string) => /asist[eê]nci|attendance|presen[cç]a/i.test(label);

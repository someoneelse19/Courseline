// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Assignment, AssignmentGroup, Course } from '../api/types';
import { AssignmentDetailPage } from './AssignmentDetailPage';
import { CourseGradesPage } from './CourseGradesPage';

// The screen side of the flags extension mode sets: `estimated` on the student's enrollment (the grade was worked out
// by Courseline, not read from Canvas) and `instructions_unknown` / `description_removed` on an assignment.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: { course: Course | undefined; groups: AssignmentGroup[] | undefined; assignment: Assignment | undefined } = { course: undefined, groups: undefined, assignment: undefined };
const query = <T,>(d: T | undefined) => ({ data: d, error: null, refetch: vi.fn(), isLoading: false });
vi.mock('../hooks/useCanvasData', () => ({
  useCourse: () => query(data.course),
  useAssignmentGroups: () => query(data.groups),
  useAssignment: () => query(data.assignment),
  useMySubmission: () => query(undefined),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ source: 'extension', user: { id: 42, name: 'Me' } }), useApi: () => ({}) }));
vi.mock('../context/FileViewerContext', () => ({ useFileViewer: () => ({ openFile: vi.fn() }) }));

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function render(path: string, pattern: string, page: React.ReactElement) {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path={pattern} element={page} /></Routes></MemoryRouter>));
  cleanup = () => {
    act(() => root.unmount());
    el.remove();
  };
  return el;
}

// One assignment graded 7/10: Courseline's own figure is 70%.
const groups: AssignmentGroup[] = [
  {
    id: 90,
    name: 'Tareas',
    position: 1,
    group_weight: 0,
    rules: {},
    assignments: [{ id: 701, name: 'Set 1', course_id: 9, points_possible: 10, due_at: null, submission_types: ['online_upload'], submission: { assignment_id: 701, score: 7, workflow_state: 'graded' } } as unknown as Assignment],
  } as AssignmentGroup,
];
const courseWith = (enrollment: object) => ({ id: 9, name: 'Calculus', apply_assignment_group_weights: false, enrollments: [{ type: 'student', enrollment_state: 'active', ...enrollment }] }) as unknown as Course;
const gradesScreen = () => render('/courses/9/grades', '/courses/:courseId/grades', <CourseGradesPage />);

describe('the Grades screen in extension mode', () => {
  it('labels an estimate as worked out by Courseline, and never treats it as Canvas\'s figure', async () => {
    data.groups = groups;
    // An estimate that disagrees with the screen's own maths would otherwise raise "Rebuilt here".
    data.course = courseWith({ computed_current_score: 72, computed_final_score: 72, estimated: true });
    const el = await gradesScreen();
    const text = el.textContent ?? '';
    expect(text).toContain('Worked out by Courseline from the scores it has seen');
    expect(text).not.toContain('Rebuilt here');
    expect(text).toContain('70.0%');
    expect(text).not.toContain('72.0%');
  });

  it('shows Canvas\'s own total as the headline, with no estimate label', async () => {
    data.groups = groups;
    data.course = courseWith({ computed_current_score: 72 });
    const el = await gradesScreen();
    const text = el.textContent ?? '';
    expect(text).toContain('72.0%');
    expect(text).not.toContain('Worked out by Courseline');
    expect(text).toContain('Rebuilt here from your scores: 70.0%'); // Canvas's total and the scores disagree: said, not hidden
  });
});

describe('the assignment screen in extension mode', () => {
  const assignment = (extra: object) => ({ id: 701, name: 'Set 1', course_id: 9, points_possible: 10, due_at: null, submission_types: ['online_upload'], html_url: 'https://school.test/courses/9/assignments/701', ...extra }) as unknown as Assignment;
  const screen = () => render('/courses/9/assignments/701', '/courses/:courseId/assignments/:assignmentId', <AssignmentDetailPage />);

  it('says the instructions have not been synced yet when no source carried them', async () => {
    data.assignment = assignment({ instructions_unknown: true });
    const text = (await screen()).textContent ?? '';
    expect(text).toContain('Instructions have not been synced yet');
    expect(text).not.toContain('No instructions provided.');
  });

  it('says "No instructions provided." when a source said there are none', async () => {
    data.assignment = assignment({ description: '' });
    const text = (await screen()).textContent ?? '';
    expect(text).toContain('No instructions provided.');
    expect(text).not.toContain('not been synced yet');
  });

  it('says instructions were not kept when they held a link that works without signing in', async () => {
    data.assignment = assignment({ description_removed: true });
    const text = (await screen()).textContent ?? '';
    expect(text).toContain('Courseline does not keep them');
    expect(text).not.toContain('not been synced yet');
    expect(text).not.toContain('No instructions provided.');
  });
});

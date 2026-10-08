import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { installFetch, json, type Call } from './test/fakeFetch';

// Smoke test for the screens: every route renders against a small fake Canvas, through the real providers,
// cache and lazy-loaded pages. It checks the screens come up with their data, not how they look.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const graded = (score: number, gradedAt: string) => ({ workflow_state: 'graded', score, grade: String(score), graded_at: gradedAt, submitted_at: gradedAt });
const enrollment = { type: 'student', enrollment_state: 'active', computed_current_score: 85, computed_current_grade: 'B' };
const course = { id: 1, name: 'Biology', course_code: 'BIO101', term: { id: 1, name: 'Fall' }, enrollments: [enrollment] };
const lab = {
  id: 5,
  course_id: 1,
  name: 'Lab report',
  due_at: '2026-09-20T23:59:00Z',
  points_possible: 10,
  html_url: 'https://school.test/courses/1/assignments/5',
  submission_types: ['online_upload'],
  description: '<p>Write it up using <a href="/courses/1/files/77">rubric.pdf</a>.</p>',
  submission: graded(8, '2026-09-22T10:00:00Z'),
};
const quiz = { ...lab, id: 7, name: 'Quiz 1', description: '', submission: graded(9, '2026-09-25T10:00:00Z') };
const essay = { ...lab, id: 6, name: 'Essay', due_at: null, points_possible: 20, description: '', submission: { workflow_state: 'unsubmitted' } };
const syllabus = { page_id: 3, url: 'syllabus', title: 'Syllabus', body: '<p>Welcome to Bio</p>' };

const routes: Record<string, unknown> = {
  '/api/v1/users/self/profile': { id: 42, name: 'Sam Student', short_name: 'Sam' },
  '/api/v1/courses': [course],
  '/api/v1/courses/1': { ...course, apply_assignment_group_weights: false },
  '/api/v1/users/self/upcoming_events': [{ id: 'assignment_6', title: 'Essay', type: 'assignment', html_url: '', start_at: null, end_at: null, context_code: 'course_1', assignment: essay }],
  '/api/v1/courses/1/assignments': [lab, quiz, essay],
  '/api/v1/courses/1/assignments/5': lab,
  '/api/v1/courses/1/assignments/5/submissions/self': { ...lab.submission, body: '<p>My lab</p>', submission_comments: [{ id: 1, author_id: 9, author_name: 'Prof', comment: 'Nice work', created_at: '2026-09-23T10:00:00Z' }] },
  '/api/v1/courses/1/assignment_groups': [{ id: 1, name: 'Labs', position: 1, group_weight: 0, assignments: [lab, quiz, essay] }],
  '/api/v1/courses/1/modules': [
    {
      id: 10,
      name: 'Week 1',
      position: 1,
      items_count: 2,
      items: [
        { id: 100, module_id: 10, position: 1, title: 'Slides.pdf', type: 'File', content_id: 77, content_details: { size: 2048 } },
        { id: 101, module_id: 10, position: 2, title: 'Syllabus', type: 'Page', page_url: 'syllabus' },
      ],
    },
  ],
  '/api/v1/courses/1/pages': [syllabus],
  '/api/v1/courses/1/pages/syllabus': syllabus,
  '/api/v1/courses/1/files': [
    { id: 77, display_name: 'Slides.pdf', filename: 'slides.pdf', url: 'https://school.test/files/77/download', size: 2048 },
    { id: 78, display_name: 'Extra.docx', filename: 'extra.docx', url: 'https://school.test/files/78/download', size: 4096 },
  ],
};
// The dev proxy (VITE_USE_DEV_PROXY in a local .env) puts every request under /canvas-proxy.
const path = (c: Call) => c.url.pathname.replace(/^\/canvas-proxy/, '');

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
let calls: Call[];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('better-canvas.credentials', JSON.stringify({ baseUrl: 'https://school.test', token: 'T' }));
  localStorage.setItem('theme', 'light');
  ({ calls } = installFetch((c) => (path(c) in routes ? json(routes[path(c)]) : undefined)));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const show = (at: string) =>
  act(async () =>
    root.render(
      <ThemeProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[at]}>
            <App />
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>,
    ),
  );

async function until(...texts: string[]) {
  for (let i = 0; i < 400; i++) {
    if (texts.every((t) => host.textContent?.includes(t))) return;
    await act(() => new Promise((r) => setTimeout(r, 10)));
  }
  throw new Error(`Never showed ${JSON.stringify(texts)}. The page says: ${host.textContent}`);
}

describe('screens', () => {
  it.each([
    ['/', ['Welcome, Sam', 'Essay', 'BIO101', '85.0% (B)']],
    ['/courses', ['BIO101 · Fall']],
    ['/assignments', ['Pending (1)', 'Done (2)', 'Essay']],
    ['/courses/1', ['Week 1', 'Slides.pdf', 'Welcome to Bio']],
    ['/courses/1/assignments', ['Lab report', '8/10', 'Quiz 1']],
    ['/courses/1/files', ['Slides.pdf', 'Not in a unit', 'Extra.docx']],
    ['/courses/1/grades', ['Current grade', 'Grade over time', 'Labs']],
    ['/courses/1/assignments/5', ['Instructions', 'rubric.pdf', 'Nice work']],
    ['/courses/1/assignments/5/submission', ['Your submission', '8 / 10', 'My lab']],
    ['/settings', ['Accent color', 'Choose your courses', '1 of 1 selected']],
    ['/nowhere', ['Page not found']],
  ])('%s', async (at, texts) => {
    await show(at);
    await until(...texts);
  }, 15_000);
});

describe('data loading', () => {
  it('the Pages tab takes page bodies from the list, with no request per page', async () => {
    await show('/courses/1');
    await until('Welcome to Bio', 'Syllabus');
    expect(calls.map(path)).toContain('/api/v1/courses/1/pages');
    expect(calls.filter((c) => path(c).startsWith('/api/v1/courses/1/pages/'))).toEqual([]);
  }, 15_000);

  it('opens a course from the sidebar', async () => {
    await show('/');
    await until('Welcome, Sam');
    const link = [...host.querySelectorAll('aside a')].find((a) => a.textContent === 'Biology') as HTMLAnchorElement;
    await act(async () => link.click());
    await until('Current grade: 85.0% (B)', 'Welcome to Bio');
  }, 15_000);
});

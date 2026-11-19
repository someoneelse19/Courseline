import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { PullProvider } from './context/PullContext';
import { setLanguage } from './i18n';
import { ThemeProvider } from './context/ThemeContext';
import { installFetch, json, type Call } from './test/fakeFetch';
import { resetHiddenCommunities } from './lib/communities';
import { resetSeen } from './lib/seen';
import { resetReadHere } from './lib/canvasRead';
import { resetFeedbackSeen } from './lib/feedback';

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
  // The same address serves announcements (asked with only_announcements=true) and discussions: see the handler below.
  '/api/v1/courses/1/users': [{ id: 7, name: 'Prof Rivera', sortable_name: 'Rivera, Prof', enrollments: [{ type: 'TeacherEnrollment' }] }],
  '/api/v1/courses/1/discussion_topics': [{ id: 92, title: 'Week 2 questions', message: '<p>Ask here</p>', posted_at: '2026-10-02T10:00:00Z', discussion_subentry_count: 3, author: { display_name: 'Prof Rivera' } }],
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
  // Kept in memory between tests otherwise.
  resetReadHere();
  resetFeedbackSeen();
  localStorage.setItem('courseline.credentials', JSON.stringify({ baseUrl: 'https://school.test', token: 'T' }));
  localStorage.setItem('theme', 'light');
  const announcements = [{ id: 91, title: 'Midterm moved', message: '<p>The midterm is now Friday.</p>', posted_at: '2026-10-01T10:00:00Z', is_announcement: true, author: { display_name: 'Prof Rivera' } }];
  ({ calls } = installFetch((c) => {
    if (path(c) === '/api/v1/courses/1/discussion_topics' && c.url.searchParams.get('only_announcements') === 'true') return json(announcements);
    return path(c) in routes ? json(routes[path(c)]) : undefined;
  }));
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
            <LanguageProvider>
              <PullProvider>
                <App />
              </PullProvider>
            </LanguageProvider>
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
    ['/courses/1/announcements', ['Midterm moved', 'Prof Rivera', 'Week 2 questions']],
    ['/courses/1/export', ['Week 1', 'Slides.pdf', 'Welcome to Bio']], // the old AI export address lands on the course
    ['/courses/1/grades', ['Current grade', 'Grade over time', 'Labs']],
    ['/courses/1/people', ['People', 'Prof Rivera', 'Everyone 1', 'Teachers 1', 'Message']],
    ['/courses/1/assignments/5', ['Instructions', 'rubric.pdf', 'Nice work']],
    ['/courses/1/assignments/5/submission', ['Instructions', 'rubric.pdf', 'Nice work']], // the old full-submission address lands on the assignment
    ['/calendar', ['Calendar', 'Today']],
    ['/communities', ['Communities', 'No communities.']],
    ['/settings', ['Appearance', 'Accent color']],
    ['/settings?tab=courses', ['Choose your courses', '1 of 1 selected', 'Course order, colors and icons']],
    ['/nowhere', ['Page not found']],
  ])('%s', async (at, texts) => {
    await show(at);
    await until(...texts);
  }, 15_000);
});

describe('communities', () => {
  const library = { id: 2, name: 'Biblioteca Campus Madrid', enrollments: [enrollment] };
  const calculus2 = { id: 3, name: 'CÁLCULO II (2026PBOK001108M1100)', start_at: '2026-09-01T00:00:00Z', enrollments: [enrollment] };
  const hours = { id: 301, title: 'Extended opening hours', message: '<p>Open until 23:00</p>', posted_at: new Date(Date.now() - 86_400_000).toISOString(), read_state: 'unread', author: { display_name: 'Library' } };
  const forum = { id: 302, title: 'Study groups', message: '<p>Find a group</p>', posted_at: '2026-10-01T10:00:00Z', discussion_subentry_count: 4 };
  const home = { page_id: 9, url: 'home', title: 'Welcome to the library', body: '<p>Opening hours and loans</p>', front_page: true };
  const community: Record<string, unknown> = {
    // Library is a community; Calculus II is next semester's class, not chosen yet.
    '/api/v1/courses': [course, library, calculus2],
    '/api/v1/courses/2': library,
    '/api/v1/courses/2/pages': [home],
    '/api/v1/courses/2/modules': [],
    '/api/v1/courses/2/assignments': [],
    '/api/v1/courses/2/files': [],
  };
  beforeEach(() => {
    // localStorage is cleared before each test, but these keep a copy in memory.
    resetSeen();
    resetHiddenCommunities();
    localStorage.setItem('courseline.selected-courses', JSON.stringify([1]));
    ({ calls } = installFetch((c) => {
      const p = path(c);
      if (p === '/api/v1/courses/2/discussion_topics') return json(c.url.searchParams.get('only_announcements') === 'true' ? [hours] : [forum]);
      return p in community ? json(community[p]) : p in routes ? json(routes[p]) : undefined;
    }));
  });

  it('the hub: one feed with the news of every community, and a directory', async () => {
    await show('/communities');
    await until('Latest news', 'Extended opening hours', 'New', 'Your communities', 'Biblioteca Campus Madrid');
    expect(host.querySelector('a[href="/communities/2"]')).not.toBeNull();
    // Biology is one of the student's courses, not a community: no news fetched for it here.
    expect(host.querySelector('a[href="/communities/1"]')).toBeNull();
    // Next semester's class is listed apart, not as a community, and its news is not read.
    await until('Classes not in your list (1)');
    expect(host.querySelector('a[href="/communities/3"]')).toBeNull();
    expect(host.querySelector('a[href="/courses/3"]')?.textContent).toBe('CÁLCULO II (2026PBOK001108M1100)');
    expect(calls.some((c) => path(c).startsWith('/api/v1/courses/3/'))).toBe(false);
  }, 15_000);

  it('a community: news, resources and discussions on one page, with no grade', async () => {
    await show('/communities/2');
    await until('News', 'Extended opening hours', 'Resources', 'Opening hours and loans', 'Discussions', 'Study groups');
    expect(host.textContent).not.toContain('Current grade');
    expect(host.textContent).not.toContain('Activities'); // it has no assignments
    expect(host.querySelector('a[href="https://school.test/courses/2"]')).not.toBeNull();
  }, 15_000);

  it('opening the feed marks the posts Canvas has unread as read there too', async () => {
    ({ calls } = installFetch((c) => {
      const p = path(c);
      if (c.init?.method === 'PUT' && p.endsWith('/read')) return new Response(null, { status: 204 });
      if (p === '/api/v1/courses/2/discussion_topics') return json(c.url.searchParams.get('only_announcements') === 'true' ? [hours] : [forum]);
      return p in community ? json(community[p]) : p in routes ? json(routes[p]) : undefined;
    }));
    await show('/communities');
    await until('Extended opening hours', 'New');
    for (let i = 0; i < 20 && !calls.some((c) => c.init?.method === 'PUT'); i++) await act(() => new Promise((r) => setTimeout(r, 25)));
    expect(calls.filter((c) => c.init?.method === 'PUT').map(path)).toEqual(['/api/v1/courses/2/discussion_topics/301/read']);
    // The sidebar's count goes at once, before Canvas's list is fetched again.
    const link = [...host.querySelectorAll('aside a')].find((a) => a.textContent?.startsWith('Communities'))!;
    expect(link.textContent).not.toMatch(/\d/);
  }, 15_000);

  it('the sidebar counts new community posts', async () => {
    await show('/');
    await until('Welcome, Sam');
    const link = [...host.querySelectorAll('aside a')].find((a) => a.textContent?.startsWith('Communities'))!;
    await until('1 new post');
    expect(link.textContent).toContain('1');
  }, 15_000);
});

describe('unread markers come from Canvas (with a token)', () => {
  // Canvas has the lab unread with one teacher comment (its grade is older than the comment: only the comment is new) and
  // the quiz unread with no comments (its grade is new); nothing else.
  const readStates = (courseId: string) => ({
    data: {
      course: {
        submissionsConnection: {
          nodes:
            courseId === '1'
              ? [
                  { readState: 'unread', unreadCommentCount: 1, hasUnreadRubricAssessment: false, assignment: { _id: '5' } },
                  { readState: 'unread', unreadCommentCount: 0, hasUnreadRubricAssessment: false, assignment: { _id: '7' } },
                ]
              : [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  });
  beforeEach(() => {
    ({ calls } = installFetch((c) => {
      const p = path(c);
      if (p === '/api/graphql') return json(readStates(String(JSON.parse(String(c.init?.body)).variables.courseId)));
      if (c.init?.method === 'PUT' && /\/read(\/comment)?$/.test(p)) return new Response(null, { status: 204 });
      if (p === '/api/v1/courses/1/discussion_topics' && c.url.searchParams.get('only_announcements') === 'true') return json([]);
      return p in routes ? json(routes[p]) : undefined;
    }));
  });
  const puts = () => calls.filter((c) => c.init?.method === 'PUT').map(path);

  it('marks feedback new because Canvas has it unread, though it is older than anything recorded here', async () => {
    await show('/assignments');
    await until('Done (2)', 'New feedback');
  }, 15_000);

  it('opening the assignment shows what is new and marks it read in Canvas', async () => {
    await show('/courses/1/assignments/5');
    await until('Lab report', 'Nice work', 'New feedback');
    await until('New'); // the comment's own marker
    for (let i = 0; i < 20 && !puts().length; i++) await act(() => new Promise((r) => setTimeout(r, 25)));
    expect(puts()).toContain('/api/v1/courses/1/assignments/5/submissions/42/read');
  }, 15_000);

  it('the Grades screen marks the row; opening it shows the submission and feedback and marks them read', async () => {
    await show('/courses/1/grades');
    await until('Labs', 'Lab report', 'New feedback', 'New grade');
    const nameCell = (name: string) => [...host.querySelectorAll('tbody td:first-child')].find((td) => td.textContent?.includes(name))!;
    // Each row says what is new: the lab only its comment (its grade is older), the quiz only its grade.
    expect(nameCell('Lab report').textContent).toContain('New feedback');
    expect(nameCell('Quiz 1').textContent).toContain('New grade');
    expect(nameCell('Quiz 1').textContent).not.toContain('New feedback');
    // Once the lab's comments are loaded, its grade is known not to be new.
    for (let i = 0; i < 40 && calls.every((c) => !path(c).endsWith('/assignments/5/submissions/self')); i++) await act(() => new Promise((r) => setTimeout(r, 25)));
    await act(() => new Promise((r) => setTimeout(r, 25)));
    expect(nameCell('Lab report').textContent).not.toContain('New grade');
    // The Grades tab carries the dot too.
    const tab = [...host.querySelectorAll('nav a')].find((a) => a.textContent?.startsWith('Grades'))!;
    expect(tab.textContent).toContain('2 new');
    expect(puts()).toEqual([]);

    const row = [...host.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes('Lab report'))!;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await act(async () => (row as HTMLElement).click());
    await until('Your submission', 'Nice work', 'View assignment →');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('a[href="/courses/1/assignments/5"]')?.textContent).toBe('View assignment →');
    for (let i = 0; i < 20 && !puts().length; i++) await act(() => new Promise((r) => setTimeout(r, 25)));
    expect(puts()).toContain('/api/v1/courses/1/assignments/5/submissions/42/read');
    // Read now: the row's marker goes, the comment keeps its own for this visit.
    await act(() => new Promise((r) => setTimeout(r, 25)));
    expect(nameCell('Lab report').textContent).not.toContain('New feedback');
    expect(host.textContent).toContain('1 new'); // "Feedback · 1 new"

    // A second click closes it.
    await act(async () => (row as HTMLElement).click());
    expect(host.textContent).not.toContain('View assignment →');
  }, 15_000);
});

describe('people in a huge course', () => {
  it('shows the first 500 students, then everyone after a click on Load everyone', async () => {
    // A course of 700 students in pages of 100, and its teacher.
    installFetch((c) => {
      if (path(c) !== '/api/v1/courses/1/users') return path(c) in routes ? json(routes[path(c)]) : undefined;
      if (c.url.searchParams.getAll('enrollment_type[]').includes('teacher')) return json([{ id: 7, name: 'Prof Rivera', enrollments: [{ type: 'TeacherEnrollment' }] }]);
      const n = Number(c.url.searchParams.get('page') ?? 0);
      const body = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + n * 100 + i, name: `Student ${n * 100 + i}`, enrollments: [{ type: 'StudentEnrollment' }] }));
      return json(body, n < 6 ? { headers: { Link: `<https://school.test/api/v1/courses/1/users?enrollment_type[]=student&page=${n + 1}&per_page=100>; rel="next"` } } : {});
    });
    await show('/courses/1/people');
    await until('Showing the first 500 students.', 'Students 500+', '501+ people');
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Load everyone')!;
    await act(async () => button.click());
    await until('Students 700', '701 people');
    expect(host.textContent).not.toContain('Load everyone');
  }, 15_000);
});

describe('language', () => {
  afterEach(() => {
    localStorage.removeItem('courseline.language');
    setLanguage('en');
  });

  it('shows Spanish when it is the saved language', async () => {
    localStorage.setItem('courseline.language', 'es');
    await show('/settings?tab=courses');
    await until('Elige tus cursos', '1 de 1 seleccionados');
    expect(document.documentElement.lang).toBe('es');
  });

  it('switching language in Settings translates the page and is remembered', async () => {
    await show('/settings');
    await until('Accent color');
    const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Language"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(picker, 'es');
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until('Color de acento');
    expect(localStorage.getItem('courseline.language')).toBe('es');
  });
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

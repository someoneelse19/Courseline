import { describe, expect, it } from 'vitest';
import type { CapturedRecord, Snapshot } from './bridge';
import { discoverLinks, pendingLinks, planLinks } from './linkDiscovery';

const snap = (bodies: unknown[]): Snapshot => ({
  records: bodies.map((body, i): CapturedRecord => ({ kind: 'x', courseId: 1, host: 'h.test', url: `u${i}`, capturedAt: i, body })),
  health: {},
  appPinned: null,
  canvasHost: 'h.test',
  takenAt: 1,
});

describe('discoverLinks', () => {
  it('finds no links in a response that failed its shape check (kept aside, not used)', () => {
    const s = snap([[{ name: 'Essay 1', html_url: 'https://h.test/courses/1/assignments/5' }]]);
    expect(discoverLinks(s, 'h.test', null)).toHaveLength(1);
    s.records[0].rejectedAs = 'assignments';
    expect(discoverLinks(s, 'h.test', null)).toEqual([]);
  });

  it('finds assignment, page, discussion, quiz, file and module-item links wherever they are, once each', () => {
    const links = discoverLinks(
      snap([
        [{ name: 'Essay 1', html_url: 'https://h.test/courses/1/assignments/5' }],
        { items: [{ title: 'Read this', html_url: 'https://h.test/courses/1/modules/items/77', page_url: 'intro' }] },
        // inside HTML: absolute, relative and with query strings
        { body: '<a href="/courses/1/pages/week-2?x=1">Week 2</a> <a href="https://h.test/courses/1/files/42/download">PDF</a>' },
        { body: '<a href="/courses/1/quizzes/9">Quiz</a> and again /courses/1/assignments/5/submissions/1' },
        [{ title: 'Welcome', html_url: 'https://h.test/courses/1/discussion_topics/3' }],
        { text: 'see /courses/1/announcements/8' },
      ]),
      'h.test',
      null,
    );
    const byUrl = Object.fromEntries(links.map((l) => [l.url, l]));
    expect(Object.keys(byUrl).sort()).toEqual([
      'https://h.test/courses/1/assignments/5',
      'https://h.test/courses/1/discussion_topics/3',
      'https://h.test/courses/1/discussion_topics/8',
      'https://h.test/courses/1/files/42',
      'https://h.test/courses/1/modules/items/77',
      'https://h.test/courses/1/pages/week-2',
      'https://h.test/courses/1/quizzes/9',
    ]);
    expect(byUrl['https://h.test/courses/1/assignments/5']).toMatchObject({ kind: 'assignment', title: 'Essay 1' });
    expect(byUrl['https://h.test/courses/1/discussion_topics/3'].title).toBe('Welcome');
  });

  it('ignores other hosts, other courses when a set is given, and non-item addresses', () => {
    const links = discoverLinks(
      snap([{ a: 'https://evil.test/courses/1/assignments/5', b: '/courses/2/assignments/6', c: '/courses/1/assignments/new', d: '/courses/1/files/folder', e: '/courses/1/assignments/syllabus' }]),
      'h.test',
      new Set([1]),
    );
    expect(links.map((l) => [l.kind, l.url])).toEqual([['syllabus', 'https://h.test/courses/1/assignments/syllabus']]);
  });
});

describe('pendingLinks and planLinks', () => {
  const links = discoverLinks(snap([['/courses/2/files/1', '/courses/1/pages/p', '/courses/1/assignments/5', '/courses/1/assignments/syllabus']]), 'h.test', null);
  const now = 10 * 3600e3;

  it('drops pages opened recently, and orders by course then by what matters most', () => {
    const visited = { 'https://h.test/courses/1/pages/p': now - 3600e3, 'https://h.test/courses/2/files/1': now - 30 * 3600e3 };
    const pending = pendingLinks(links, visited, now);
    expect(pending.map((l) => l.url)).toEqual([
      'https://h.test/courses/1/assignments/syllabus',
      'https://h.test/courses/1/assignments/5',
      'https://h.test/courses/2/files/1', // opened more than a day ago: due again
    ]);
  });

  it('labels each step with the course and the item, and respects the limit', () => {
    const steps = planLinks(pendingLinks(links, {}, now), new Map([[1, 'Biology']]), 2);
    expect(steps).toHaveLength(2);
    expect(steps[0].label).toBe('Biology · Syllabus');
    expect(steps[1].label).toBe('Biology · Assignment · 5');
  });
});

describe('discoverLinks: subfolders named in folder listings', () => {
  it('opens each subfolder by its path under "course files", for the chosen courses only', () => {
    const listing = (body: unknown[]): CapturedRecord => ({ kind: 'folderContents', courseId: null, host: 'h.test', url: 'https://h.test/api/v1/folders/1/all', capturedAt: 1, body });
    const s: Snapshot = {
      records: [
        listing([
          { id: '5', name: 'Block 1', full_name: 'course files/Block 1', context_type: 'Course', context_id: '1' },
          { id: '6', name: 'Lab #2', full_name: 'course files/Labs/Lab #2', context_type: 'Course', context_id: '1' },
          { id: '7', name: 'course files', full_name: 'course files', context_type: 'Course', context_id: '1' },
          { id: '8', name: 'Other', full_name: 'course files/Other', context_type: 'Course', context_id: '2' },
          { id: '9', display_name: 'a.pdf', size: 1, context_asset_string: 'course_1' },
        ]),
      ],
      health: {},
      appPinned: null,
      canvasHost: 'h.test',
      takenAt: 1,
    };
    const folders = discoverLinks(s, 'h.test', new Set([1])).filter((l) => l.kind === 'folder');
    expect(folders.map((l) => l.url)).toEqual(['https://h.test/courses/1/files/folder/Block%201', 'https://h.test/courses/1/files/folder/Labs/Lab%20%232']);
    expect(folders[1].title).toBe('Labs / Lab #2');
  });
});

describe('discoverLinks: assignments named by id', () => {
  it('opens each assignment the Grades page data or planner items name, even with no link (a course whose Assignments tab is hidden)', () => {
    const r = (kind: string, courseId: number | null, body: unknown): CapturedRecord => ({ kind, courseId, host: 'h.test', url: `https://h.test/x/${kind}`, capturedAt: 1, body });
    const s: Snapshot = {
      records: [
        r('gradesPage', 4, {
          assignment_groups: [{ id: '40', assignments: [{ id: '41' }, { id: '42' }, { id: 'x' }] }],
          submissions: [],
          // 41's row links to its submission; 42's row has no link.
          assignments: [{ id: '41', name: 'Ecuaciones', html_url: 'https://h.test/courses/4/assignments/41' }, { id: '42', name: 'Práctica' }],
        }),
        r('gradesPage', 9, { assignment_groups: [{ id: '90', assignments: [{ id: '91' }] }], submissions: [], assignments: [] }),
        r('plannerItems', null, [
          { plannable_type: 'assignment', course_id: '4', plannable_id: '43', plannable: { title: 'Repaso' } },
          { plannable_type: 'assignment', course_id: '4', plannable_id: '42', plannable: { title: 'Planner name' } },
          { plannable_type: 'quiz', course_id: '4', plannable_id: '44', plannable: { title: 'Quiz' } },
          { plannable_type: 'assignment', course_id: '9', plannable_id: '92', plannable: { title: 'Other course' } },
        ]),
      ],
      health: {},
      appPinned: null,
      canvasHost: 'h.test',
      takenAt: 1,
    };
    const links = discoverLinks(s, 'h.test', new Set([4]));
    expect(links.map((l) => [l.url, l.kind, l.title]).sort()).toEqual([
      ['https://h.test/courses/4/assignments/41', 'assignment', 'Ecuaciones'],
      ['https://h.test/courses/4/assignments/42', 'assignment', 'Práctica'],
      ['https://h.test/courses/4/assignments/43', 'assignment', 'Repaso'],
    ]);
    // Once each: the row link and the ENV id are the same page.
    expect(links.filter((l) => l.url.endsWith('/assignments/41'))).toHaveLength(1);
    // With no course filter, the other course's come too.
    expect(discoverLinks(s, 'h.test', null).map((l) => l.url)).toEqual(expect.arrayContaining(['https://h.test/courses/9/assignments/91', 'https://h.test/courses/9/assignments/92']));
  });
});

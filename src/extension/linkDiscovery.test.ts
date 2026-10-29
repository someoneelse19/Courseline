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

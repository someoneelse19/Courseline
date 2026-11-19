import { afterEach, describe, expect, it } from 'vitest';
import type { DiscussionTopic } from '../api/types';
import { buildFeed, lastPostAt, looksLikeClass, newCount, resetHiddenCommunities, setCommunityHidden, setCourseKind, type CommunityNews } from './communities';

const post = (id: number, posted_at: string, extra: Partial<DiscussionTopic> = {}): DiscussionTopic => ({ id, title: `Post ${id}`, posted_at, ...extra });

const news: CommunityNews[] = [
  { courseId: 1, posts: [post(10, '2026-11-01T10:00:00Z'), post(11, '2026-11-10T10:00:00Z')] },
  { courseId: 2, posts: [post(20, '2026-11-05T10:00:00Z')] },
  { courseId: 3, posts: null }, // not synced
];

describe('buildFeed', () => {
  it('merges every community, newest first, marking the fresh ones', () => {
    const feed = buildFeed(news, new Set(), new Set(['1:11']));
    expect(feed.map((i) => [i.courseId, i.post.id, i.fresh])).toEqual([
      [1, 11, true],
      [2, 20, false],
      [1, 10, false],
    ]);
  });

  it('leaves out hidden communities and ones that could not be loaded', () => {
    expect(buildFeed(news, new Set([1]), null).map((i) => i.post.id)).toEqual([20]);
  });
});

describe('newCount and lastPostAt', () => {
  it('counts what is not seen yet, and finds the latest post', () => {
    const seen = { ids: [10], since: Date.parse('2026-11-02T00:00:00Z') };
    expect(newCount(news[0].posts, seen)).toBe(1);
    expect(newCount(null, seen)).toBe(0);
    expect(lastPostAt(news[0].posts)).toBe(Date.parse('2026-11-10T10:00:00Z'));
    expect(lastPostAt(null)).toBe(0);
  });
});

describe('hidden communities', () => {
  afterEach(() => {
    localStorage.clear();
    resetHiddenCommunities();
  });

  it('are kept in this browser', () => {
    setCommunityHidden(4, true);
    setCommunityHidden(5, true);
    setCommunityHidden(4, false);
    expect(JSON.parse(localStorage.getItem('courseline.communities.hidden')!)).toEqual([5]);
  });
});

describe('looksLikeClass', () => {
  // The owner's courses, as Canvas names them (Nov 17, 2026). The extension knows only the name.
  it('tells classes from communities by name alone', () => {
    const classes = ['ALGEBRA - GBIO EN M11 (2026PBOK001105M1100)', 'CÁLCULO II (2026PBOK001108M1100)', 'PROGRAMACIÓN AVANZADA (2026PBOK001107M1100)', 'FUNDAMENTOS DE PROGRAMACIÓN  (2026PBOK001103M1100)'];
    const communities = [
      'Biblioteca Campus Madrid',
      'Artificial Intelligence Competency. Applied Level',
      'Comunidad de Vida Universitaria',
      'GRADO EN INGENIERÍA BIOMÉDICA - BACHELOR´S DEGREE BIOMEDICAL ENGINEERING (COM_2026PBOK)',
      'Oficina de Relaciones Internacionales ',
      'Orientación Educativa, Diversidad e Inclusión Madrid',
      'Ready to work',
      'School of Life',
    ];
    for (const name of classes) expect(looksLikeClass({ name }), name).toBe(true);
    for (const name of communities) expect(looksLikeClass({ name }), name).toBe(false);
  });

  it('uses the start date when Canvas gives one, unless the course says it is a community', () => {
    expect(looksLikeClass({ name: 'Chemistry', start_at: '2026-09-01T00:00:00Z' })).toBe(true);
    expect(looksLikeClass({ name: 'Degree space (COM_2026PBOK)', start_at: '2026-09-01T00:00:00Z' })).toBe(false);
    expect(looksLikeClass({ name: 'Degree space', course_code: 'COM_2026', start_at: '2026-09-01T00:00:00Z' })).toBe(false);
    expect(looksLikeClass({ name: 'Ready to work (2026)' })).toBe(false); // a year is not a section code
  });
});

describe('class or community corrections', () => {
  afterEach(() => {
    localStorage.clear();
    resetHiddenCommunities();
  });

  it('are kept in this browser, and clearing one goes back to the guess', () => {
    setCourseKind(4, 'class');
    setCourseKind(5, 'community');
    setCourseKind(4, null);
    expect(JSON.parse(localStorage.getItem('courseline.communities.kind')!)).toEqual({ 5: 'community' });
  });
});

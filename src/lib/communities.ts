// Communities: the Canvas spaces a student belongs to besides their classes (library, student life, international
// office, the degree's own space…). Canvas builds them as courses, but they are used differently: the school posts news
// and keeps resources there; nothing is graded and there is rarely a deadline. So Courseline reads them as one news feed
// plus a directory, and lets the student hide the ones they do not care about.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DiscussionTopic } from '../api/types';
import { isNew, markSeen, useSeenAll, type SeenRecord } from './seen';

/** One community's announcements, or null when they could not be loaded (not synced yet, or hidden by the school). */
export interface CommunityNews {
  courseId: number;
  posts: DiscussionTopic[] | null;
}

export interface FeedItem {
  courseId: number;
  post: DiscussionTopic;
  fresh: boolean;
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** Every post from the communities not hidden, newest first. `fresh` holds the new ones as `courseId:postId`. */
export function buildFeed(news: CommunityNews[], hidden: ReadonlySet<number>, fresh: ReadonlySet<string> | null): FeedItem[] {
  const items: FeedItem[] = [];
  for (const { courseId, posts } of news) {
    if (hidden.has(courseId) || !posts) continue;
    for (const post of posts) items.push({ courseId, post, fresh: !!fresh?.has(`${courseId}:${post.id}`) });
  }
  return items.sort((a, b) => time(b.post.posted_at) - time(a.post.posted_at));
}

/** How many posts are new in one community. */
export function newCount(posts: DiscussionTopic[] | null, seen: SeenRecord | undefined): number {
  return (posts ?? []).filter((p) => isNew({ ...p, date: p.posted_at }, seen)).length;
}

/** When a community last posted (ms), or 0 if never / unknown. */
export function lastPostAt(posts: DiscussionTopic[] | null): number {
  return Math.max(0, ...(posts ?? []).map((p) => time(p.posted_at)));
}

/**
 * What was new when the screen opened keeps its "New" label for this visit (keys `courseId:postId`); opening the screen
 * marks those communities' posts seen. Waits for each community's starting point (see useCommunityNews). Null until then.
 */
export function useFreshOnOpen(news: CommunityNews[] | undefined, hidden: ReadonlySet<number>): ReadonlySet<string> | null {
  const seenOf = useSeenAll();
  const [fresh, setFresh] = useState<ReadonlySet<string> | null>(null);
  // Once per visit. (Marking seen re-renders at once, before `fresh` is set: the state alone would let it run twice.)
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !news) return;
    const shown = news.filter((n): n is CommunityNews & { posts: DiscussionTopic[] } => !!n.posts && !hidden.has(n.courseId));
    if (shown.some((n) => !seenOf(n.courseId, 'announcements'))) return;
    const keys = new Set<string>();
    for (const n of shown) {
      const seen = seenOf(n.courseId, 'announcements');
      for (const p of n.posts) if (isNew({ ...p, date: p.posted_at }, seen)) keys.add(`${n.courseId}:${p.id}`);
    }
    done.current = true;
    setFresh(keys);
    for (const n of shown) markSeen(n.courseId, 'announcements', n.posts.map((p) => p.id));
  }, [news, hidden, seenOf]);
  return fresh;
}

// --- Hidden communities (kept in this browser) ----------------------------------------------------------------------

const KEY = 'courseline.communities.hidden';
let cache: ReadonlySet<number> | null = null;
const listeners = new Set<() => void>();

function read(): ReadonlySet<number> {
  if (cache) return cache;
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    cache = new Set(Array.isArray(ids) ? ids.filter((x): x is number => Number.isInteger(x)) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

/** Hide a community from the feed and the new-post count, or show it again. */
export function setCommunityHidden(courseId: number, hide: boolean): void {
  const next = new Set(read());
  if (hide) next.add(courseId);
  else next.delete(courseId);
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* storage unavailable: still applies for this visit */
  }
  listeners.forEach((notify) => notify());
}

/** Forget the hidden list and the class/community corrections (tests). */
export function resetHiddenCommunities(): void {
  cache = null;
  kindsCache = null;
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

export function useHiddenCommunities(): { hidden: ReadonlySet<number>; setHidden: (courseId: number, hide: boolean) => void } {
  const hidden = useSyncExternalStore(subscribe, read);
  const setHidden = useCallback((courseId: number, hide: boolean) => setCommunityHidden(courseId, hide), []);
  return { hidden, setHidden };
}

// --- Classes or communities ------------------------------------------------------------------------------------------

/**
 * Is this course a class rather than a community? Canvas has no such flag (the school's own "Communities" page is an
 * external tool), but the courses tell: a community's name or code may say so ("… (COM_2026PBOK)"); a class has
 * start and end dates, and its name ends in its section code, like "CÁLCULO II (2026PBOK001108M1100)". The name is
 * all the extension knows of a course, so it alone has to do there. Seen on the owner's Canvas, Nov 17, 2026: every
 * class (both semesters) has both, no community has either.
 */
export function looksLikeClass(course: { name?: string; course_code?: string; start_at?: string | null }): boolean {
  const name = course.name ?? '';
  if (/\(COM[_-]/i.test(name) || /^COM[_-]/i.test(course.course_code ?? '')) return false;
  if (course.start_at) return true;
  // A closing "(CODE)": letters and digits only, at least 8, with both.
  return /\((?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\)\s*$/i.test(name);
}

export type CourseKind = 'class' | 'community';

const KINDS_KEY = 'courseline.communities.kind';
let kindsCache: Readonly<Record<number, CourseKind>> | null = null;

function readKinds(): Readonly<Record<number, CourseKind>> {
  if (kindsCache) return kindsCache;
  try {
    const raw = JSON.parse(localStorage.getItem(KINDS_KEY) ?? '{}') as unknown;
    const out: Record<number, CourseKind> = {};
    if (raw && typeof raw === 'object') for (const [id, kind] of Object.entries(raw)) if (kind === 'class' || kind === 'community') out[Number(id)] = kind;
    kindsCache = out;
  } catch {
    kindsCache = {};
  }
  return kindsCache;
}

/** The student's correction when the guess is wrong (null: back to the guess). */
export function setCourseKind(courseId: number, kind: CourseKind | null): void {
  const next = { ...readKinds() };
  if (kind) next[courseId] = kind;
  else delete next[courseId];
  kindsCache = next;
  try {
    localStorage.setItem(KINDS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: still applies for this visit */
  }
  listeners.forEach((notify) => notify());
}

/** `isClass(course)`: the student's correction, else looksLikeClass. */
export function useCourseKinds(): { isClass: (course: { id: number; name?: string; course_code?: string; start_at?: string | null }) => boolean; setKind: typeof setCourseKind } {
  const kinds = useSyncExternalStore(subscribe, readKinds);
  const isClass = useCallback((course: { id: number; name?: string; course_code?: string; start_at?: string | null }) => (kinds[course.id] ? kinds[course.id] === 'class' : looksLikeClass(course)), [kinds]);
  return { isClass, setKind: setCourseKind };
}

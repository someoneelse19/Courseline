// What the student has already seen in each course (announcements, assignments), so a course tab can show a dot for
// what is new. Kept in this browser (localStorage `courseline.seen`): Canvas has no "seen" for assignments, and reading
// an announcement here does not mark it read in Canvas. Per course and kind: the ids seen, and since when this is kept.
import { useCallback, useSyncExternalStore } from 'react';

export type SeenKind = 'announcements' | 'assignments';
export interface SeenRecord {
  ids: number[];
  /** When the course's list was first recorded (ms): anything dated before it was already there. */
  since: number;
}

const KEY = 'courseline.seen';
type Store = Record<string, SeenRecord>;

let cache: Store | null = null;
const listeners = new Set<() => void>();

function read(): Store {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    cache = {};
  }
  return cache;
}

const keyOf = (courseId: number, kind: SeenKind) => `${courseId}:${kind}`;

/** Adds `ids` to what has been seen (the first call for a course and kind also starts the record). */
export function markSeen(courseId: number, kind: SeenKind, ids: number[], now = Date.now()): void {
  const store = read();
  const prev = store[keyOf(courseId, kind)];
  if (prev && ids.every((id) => prev.ids.includes(id))) return;
  cache = { ...store, [keyOf(courseId, kind)]: { ids: [...new Set([...(prev?.ids ?? []), ...ids])], since: prev?.since ?? now } };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable: still counts for this visit */
  }
  listeners.forEach((notify) => notify());
}

/** Forget everything (tests). */
export function resetSeen(): void {
  cache = {};
  listeners.forEach((notify) => notify());
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

/** The seen record for one course and kind, kept current; undefined until the course's list was first recorded. */
export function useSeen(courseId: number, kind: SeenKind): SeenRecord | undefined {
  const get = useCallback(() => read()[keyOf(courseId, kind)], [courseId, kind]);
  return useSyncExternalStore(subscribe, get);
}

/**
 * Is this item new? Not seen here, not marked read in Canvas, and not older than the record (an older item that turns
 * up later, say from a page the extension had not captured yet, was already there). Canvas's own "unread" always counts.
 */
export function isNew(item: { id: number; read_state?: string; date?: string | null }, seen: SeenRecord | undefined): boolean {
  if (item.read_state === 'read' || seen?.ids.includes(item.id)) return false;
  if (item.read_state === 'unread') return true;
  if (!seen) return false; // nothing recorded yet: what is there now is the starting point
  const at = item.date ? Date.parse(item.date) : NaN;
  return !(at < seen.since);
}

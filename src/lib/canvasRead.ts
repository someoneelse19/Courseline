// What this visit marked read in Canvas (an announcement opened, feedback looked at). Canvas is the source of truth
// for what is unread, but the copy of its lists the app holds was fetched before: until those lists are fetched again
// they still say "unread". This set covers that gap, for this visit only (it is not saved: after a reload Canvas's own
// answer is all there is). Keys: `topic:<courseId>:<id>`, `submission:<courseId>:<assignmentId>`.
import { useSyncExternalStore } from 'react';

let readHere: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export const topicKey = (courseId: number, topicId: number) => `topic:${courseId}:${topicId}`;
export const submissionKey = (courseId: number, assignmentId: number) => `submission:${courseId}:${assignmentId}`;

export function markReadHere(keys: string[]): void {
  const fresh = keys.filter((k) => !readHere.has(k));
  if (!fresh.length) return;
  readHere = new Set([...readHere, ...fresh]);
  listeners.forEach((notify) => notify());
}

/** Forget everything (tests). */
export function resetReadHere(): void {
  readHere = new Set();
  listeners.forEach((notify) => notify());
}

export const isReadHere = (key: string) => readHere.has(key);

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

/** The set, kept current (re-renders when something is marked read). */
export function useReadHere(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => readHere);
}

/** Runs the tasks a few at a time (marking many posts read must not hit Canvas's rate limit). Failures are ignored. */
export async function runLimited(tasks: (() => Promise<unknown>)[], limit = 4): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

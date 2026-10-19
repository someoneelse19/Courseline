import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCourseFilter } from '../context/CourseFilterContext';
import { setPinnedCourses } from '../extension/bridge';

const sameIds = (a: readonly number[] | null, b: readonly number[] | null) => {
  if (a === null || b === null) return a === b;
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
};

/**
 * Keeps the extension working with the courses chosen in Settings → Choose your courses. Renders nothing.
 * Sends the selection when it changes, and again if the extension reports something different (for example after
 * its data was cleared). Idempotent: once both sides agree it does nothing.
 */
export function ExtensionPinnedSync() {
  const { source, snapshot } = useAuth();
  const { selected } = useCourseFilter();

  useEffect(() => {
    if (source !== 'extension' || !snapshot) return;
    const wanted = selected && selected.size > 0 ? [...selected].sort((a, b) => a - b) : null;
    const has = snapshot.appPinned && snapshot.appPinned.length ? snapshot.appPinned : null;
    if (!sameIds(wanted, has)) void setPinnedCourses(wanted);
  }, [source, snapshot, selected]);

  return null;
}

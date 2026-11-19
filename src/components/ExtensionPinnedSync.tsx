import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCourseFilter } from '../context/CourseFilterContext';
import { setCommunityCourses, setPinnedCourses } from '../extension/bridge';
import { useCommunities } from '../hooks/useCanvasData';
import { useHiddenCommunities } from '../lib/communities';

const sameIds = (a: readonly number[] | null, b: readonly number[] | null) => {
  if (a === null || b === null) return a === b;
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
};

/**
 * Keeps the extension working with the courses chosen in Settings → Choose your courses, and keeping the communities
 * the student has not hidden. Renders nothing.
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

  // The communities the student has not hidden: the extension keeps their data too (else a community sync would be
  // thrown away as "not a pinned course"). Hiding a community stops that.
  const { data: communities } = useCommunities();
  const { hidden } = useHiddenCommunities();
  useEffect(() => {
    if (source !== 'extension' || !snapshot || !communities) return;
    const ids = communities.map((c) => c.id).filter((id) => !hidden.has(id)).sort((a, b) => a - b).slice(0, 200);
    const wanted = ids.length ? ids : null;
    const has = snapshot.appCommunities && snapshot.appCommunities.length ? snapshot.appCommunities : null;
    if (!sameIds(wanted, has)) void setCommunityCourses(wanted);
  }, [source, snapshot, communities, hidden]);

  return null;
}

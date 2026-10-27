import { useEffect, useMemo, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePull } from '../context/PullContext';
import { coverage, courseUpdatedAt, failingKinds, freshnessByType, lastUpdatedAt, snapshotHost, workingCourses, type FreshnessKey } from '../extension/extensionApi';
import { discoverLinks, pendingLinks } from '../extension/linkDiscovery';
import { formatAgo } from '../lib/format';
import { t, tn } from '../i18n';

const STALE_MS = 24 * 3600e3;

// Written out (not built from pieces) so each string is greppable and translated.
function typeLabel(key: FreshnessKey): string {
  switch (key) {
    case 'assignments':
      return t('Assignments');
    case 'grades':
      return t('Grades');
    case 'units':
      return t('Units');
    case 'pages':
      return t('Pages');
    case 'files':
      return t('Files');
    case 'announcements':
      return t('Announcements');
    case 'upcoming':
      return t('Upcoming work');
    case 'course':
      return t('Course info');
  }
}

/**
 * Shown only when the data comes from the browser extension: where it came from, how much of the student's
 * courses it covers, how fresh it is, and a button that opens the extension's visible Sync now window.
 * The point is that partial or old data is never presented as if it were complete and live.
 */
export function ExtensionStatus() {
  const { source, snapshot } = useAuth();
  const match = useMatch('/courses/:courseId/*');
  const { requestSync, requestDeepSync, refreshCourse, refreshKind, running } = usePull();

  // Pages linked from what has been captured that have not been opened yet (assignment instructions, page bodies...).
  const linked = useMemo(() => {
    if (!snapshot) return 0;
    const host = snapshotHost(snapshot);
    if (!host) return 0;
    const ids = new Set(workingCourses(snapshot).map((c) => c.id));
    return pendingLinks(discoverLinks(snapshot, host, ids), snapshot.visited, Date.now()).length;
  }, [snapshot]);

  // Everything below is worked out from the whole snapshot, so it is computed once per snapshot (and per course page),
  // not on every render. The minute tick only moves "stale" and "2 minutes ago" along while the page sits open.
  const courseId = match ? Number(match.params.courseId) : null;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const view = useMemo(() => {
    if (!snapshot) return null;
    const last = lastUpdatedAt(snapshot);
    const working = workingCourses(snapshot);
    return {
      cov: coverage(snapshot),
      last,
      failing: failingKinds(snapshot),
      courseAt: courseId ? courseUpdatedAt(snapshot, courseId) : null,
      stale: last !== null && Date.now() - last > STALE_MS,
      types: freshnessByType(snapshot, courseId),
      course: courseId !== null ? (working.find((c) => c.id === courseId) ?? { id: courseId, name: null }) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is only here to recompute as time passes
  }, [snapshot, courseId, tick]);

  if (source !== 'extension' || !snapshot || !view) return null;
  const { cov, last, failing, courseAt, stale, types, course } = view;
  const muted = 'text-neutral-600 dark:text-neutral-300';

  return (
    <section
      aria-label={t('Data from the Courseline extension')}
      className="mb-4 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">{t('Data from the Courseline extension')}</span>
        {cov.total > 0 && <span className={muted}>{t('{synced} of {total} courses synced', { synced: cov.synced, total: cov.total })}</span>}
        {last !== null && (
          <span className={stale ? 'text-amber-700 dark:text-amber-400' : muted}>{t('Updated {when}', { when: formatAgo(last) })}</span>
        )}
        <Link to="/settings?tab=connection" className="ml-auto text-xs text-accent-700 underline dark:text-accent-300">
          {t('Connection settings')}
        </Link>
        {linked > 0 && (
          <button
            type="button"
            disabled={running}
            onClick={requestDeepSync}
            title={t('Open the pages that captured pages link to: assignment instructions, page bodies, discussions, quizzes and files')}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {tn(linked, 'Pull {n} linked page', 'Pull {n} linked pages')}
          </button>
        )}
        <button
          type="button"
          disabled={running}
          onClick={() => requestSync()}
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('Sync now')}
        </button>
      </div>

      {types.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t('When each kind of data was last updated')}>
          {types.map((f) => {
            const warn = f.updatedAt === null || f.stale;
            const when = f.updatedAt === null ? t('not synced yet') : formatAgo(f.updatedAt);
            return (
              <li
                key={f.key}
                className={`rounded-md px-2 py-0.5 text-xs ${
                  warn ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
                }`}
              >
                <button
                  type="button"
                  disabled={running}
                  title={t('Refresh {type}', { type: typeLabel(f.key) })}
                  onClick={() => refreshKind(course ? { id: course.id, name: course.name } : null, f.key, typeLabel(f.key))}
                  className="hover:underline disabled:no-underline"
                >
                  {t('{type}: {when}', { type: typeLabel(f.key), when })}
                  {f.stale && ` · ${t('stale')}`}
                  <span aria-hidden="true"> ↻</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {courseId !== null && course && (
        <p className={`mt-1 flex flex-wrap items-center gap-2 ${courseAt === null ? 'text-amber-700 dark:text-amber-400' : muted}`}>
          <span>
            {courseAt !== null ? t('This course: updated {when}', { when: formatAgo(courseAt) }) : t('This course has not been synced yet.')}
          </span>
          <button
            type="button"
            disabled={running}
            onClick={() => refreshCourse({ id: course.id, name: course.name })}
            className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t('Refresh this course')}
          </button>
        </p>
      )}

      {cov.missing.length > 0 && (
        <p className={`mt-1 ${muted}`}>{t('Not synced yet: {names}', { names: cov.missing.map((c) => c.name ?? `#${c.id}`).join(', ') })}</p>
      )}

      {failing.length > 0 && (
        <div role="alert" className="mt-1 text-amber-700 dark:text-amber-400">
          <p>{t('Canvas sent an unexpected format for: {kinds}. That data may be out of date.', { kinds: failing.join(', ') })}</p>
          <p className="mt-0.5 text-xs">
            {t('What to do: open that page in Canvas once, or press Sync now. If it keeps happening, Canvas has probably changed and Courseline needs an update. Open the extension, press “Copy response shapes”, and send what it copies to whoever maintains Courseline.')}
          </p>
        </div>
      )}

      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{t('Grades are calculated by Courseline from the scores it has seen.')}</p>
    </section>
  );
}

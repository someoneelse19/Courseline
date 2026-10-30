import { useEffect, useMemo, useState } from 'react';
import { Link, useMatch } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePull } from '../context/PullContext';
import { coverage, courseUpdatedAt, failingKinds, freshnessByType, lastUpdatedAt, snapshotHost, valueIssues, workingCourses, type FreshnessKey } from '../extension/extensionApi';
import { discoverLinks, pendingLinks } from '../extension/linkDiscovery';
import { issueSummary } from '../extension/valueChecks';
import { formatAgo, formatAgoShort } from '../lib/format';
import { t, tn } from '../i18n';

const STALE_MS = 24 * 3600e3;
const OPEN_KEY = 'courseline.extension-status-open';

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
 * In the sidebar, under the courses, only when the data comes from the browser extension: a collapsible item whose dot
 * says at a glance whether the data is current, and which opens to where it came from, how much of the student's
 * courses it covers, how fresh each kind of data is, and Sync now. The point is that partial or old data is never
 * presented as if it were complete and live.
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
  // Collapsed or open, remembered on this browser.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable: still toggles for this visit */
    }
  };
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
      // Values Canvas sent that could not be right (a date with no time zone, statistics misread by a factor...).
      issues: valueIssues(snapshot),
      names: new Map(working.map((c) => [c.id, c.name] as const)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is only here to recompute as time passes
  }, [snapshot, courseId, tick]);

  if (source !== 'extension' || !snapshot || !view) return null;
  const { cov, last, failing, courseAt, stale, types, course, issues, names } = view;
  const muted = 'text-neutral-600 dark:text-neutral-300';
  const small = 'rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800';

  // One status for the collapsed row: a dot whose colour is backed by words (never colour alone).
  const notSynced = types.some((f) => f.core && f.updatedAt === null && !f.hidden) || cov.missing.length > 0;
  const status = running
    ? { tone: 'bg-accent-500 animate-pulse', label: t('Syncing…') }
    : failing.length > 0
      ? { tone: 'bg-red-500', label: t('Needs attention') }
      : issues.length > 0
        ? { tone: 'bg-amber-500', label: t('Needs attention') }
        : stale || notSynced || last === null
          ? { tone: 'bg-amber-500', label: last === null ? t('Not synced yet') : stale ? t('Out of date') : t('Partly synced') }
          : { tone: 'bg-green-500', label: t('Up to date') };

  return (
    <section aria-label={t('Data from the Courseline extension')} className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="extension-status-details"
        onClick={() => toggle(!open)}
        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.tone}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{t('Extension')}</span>
          <span className="block truncate text-xs font-normal text-neutral-500 dark:text-neutral-400">
            {status.label}
            {last !== null && !running ? ` · ${formatAgoShort(last)}` : ''}
          </span>
        </span>
        <svg aria-hidden viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? 'rotate-90' : ''}`}>
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id="extension-status-details" className="mt-1 space-y-2 px-3 pb-1 text-xs">
          <p className={muted}>
            {cov.total > 0 && <span className="block">{t('{synced} of {total} courses synced', { synced: cov.synced, total: cov.total })}</span>}
            {last !== null && <span className={`block ${stale ? 'text-amber-700 dark:text-amber-400' : ''}`}>{t('Updated {when}', { when: formatAgo(last) })}</span>}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={running} onClick={() => requestSync()} className={small}>
              {t('Sync now')}
            </button>
            {linked > 0 && (
              <button
                type="button"
                disabled={running}
                onClick={requestDeepSync}
                title={t('Open the pages that captured pages link to: assignment instructions, page bodies, discussions, quizzes and files')}
                className={small}
              >
                {tn(linked, 'Pull {n} linked page', 'Pull {n} linked pages')}
              </button>
            )}
          </div>

          {types.length > 0 && (
            <ul className="space-y-1" aria-label={t('When each kind of data was last updated')}>
              {types.map((f) => {
                if (f.hidden) {
                  // Not in the course's Canvas menu: nothing to refresh, and not a warning.
                  return (
                    <li
                      key={f.key}
                      title={t('Not in this course’s Canvas menu: your school may hide it, or the course may not use it. Sign in with a Canvas token to see it.')}
                      className="flex items-baseline justify-between gap-2 rounded-md bg-neutral-100 px-2 py-0.5 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                    >
                      <span className="sr-only">{t('{type}: {when}', { type: typeLabel(f.key), when: t('not in Canvas menu') })}</span>
                      <span aria-hidden className="truncate">{typeLabel(f.key)}</span>
                      <span aria-hidden className="shrink-0">{t('not in Canvas menu')}</span>
                    </li>
                  );
                }
                const warn = f.updatedAt === null || f.stale;
                const when = f.updatedAt === null ? t('not synced yet') : formatAgo(f.updatedAt);
                const shortWhen = f.updatedAt === null ? t('not synced yet') : formatAgoShort(f.updatedAt);
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      disabled={running}
                      title={`${t('{type}: {when}', { type: typeLabel(f.key), when })} · ${t('Refresh {type}', { type: typeLabel(f.key) })}`}
                      onClick={() => refreshKind(course ? { id: course.id, name: course.name } : null, f.key, typeLabel(f.key))}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-0.5 text-left hover:underline disabled:no-underline ${
                        warn ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
                      }`}
                    >
                      <span className="sr-only">
                        {t('{type}: {when}', { type: typeLabel(f.key), when })}
                        {f.stale && ` · ${t('stale')}`}
                      </span>
                      <span aria-hidden className="truncate">{typeLabel(f.key)}</span>
                      <span aria-hidden className="flex shrink-0 items-center gap-1 tabular-nums opacity-80">
                        {shortWhen}
                        {f.stale && ` · ${t('stale')}`}
                        <span>↻</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {courseId !== null && course && (
            <div className={courseAt === null ? 'text-amber-700 dark:text-amber-400' : muted}>
              <p>{courseAt !== null ? t('This course: updated {when}', { when: formatAgo(courseAt) }) : t('This course has not been synced yet.')}</p>
              <button type="button" disabled={running} onClick={() => refreshCourse({ id: course.id, name: course.name })} className={`mt-1 ${small}`}>
                {t('Refresh this course')}
              </button>
            </div>
          )}

          {cov.missing.length > 0 && <p className={muted}>{t('Not synced yet: {names}', { names: cov.missing.map((c) => c.name ?? `#${c.id}`).join(', ') })}</p>}

          {failing.length > 0 && (
            <div role="alert" className="text-amber-700 dark:text-amber-400">
              <p>{t('Canvas sent an unexpected format for: {kinds}. That data may be out of date.', { kinds: failing.join(', ') })}</p>
              <p className="mt-0.5">
                {t('What to do: open that page in Canvas once, or press Sync now. If it keeps happening, Canvas has probably changed and Courseline needs an update. Open the extension, press “Copy response shapes”, and send what it copies to whoever maintains Courseline.')}
              </p>
            </div>
          )}

          {issues.length > 0 && <ValueIssues issues={issues} names={names} />}

          <p className="text-neutral-500 dark:text-neutral-400">{t('Grades are Canvas’s own total when its Grades page shows one; otherwise Courseline works them out from the scores it has seen.')}</p>
          <Link to="/settings?tab=connection" className="inline-block text-accent-700 underline dark:text-accent-300">
            {t('Connection settings')}
          </Link>
        </div>
      )}
    </section>
  );
}

/** Values Courseline left out because they did not add up, by course and kind, with what to do about them. */
function ValueIssues({ issues, names }: { issues: ReturnType<typeof valueIssues>; names: ReadonlyMap<number, string | null> }) {
  const { lines, more } = issueSummary(issues, names);
  return (
    <div role="status" className="text-amber-700 dark:text-amber-400">
      <p>{t('Some values from Canvas did not add up, so Courseline left them out:')}</p>
      <ul className="mt-0.5 list-disc pl-4">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {more > 0 && <li>{tn(more, 'and {n} more', 'and {n} more')}</li>}
      </ul>
      <p className="mt-0.5">
        {t('What to do: check these in Canvas. If Canvas shows them correctly, press Sync now; if they are still listed, tell whoever maintains Courseline what this list says.')}
      </p>
    </div>
  );
}

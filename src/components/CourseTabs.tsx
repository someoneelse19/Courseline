import { Link, useLocation } from 'react-router-dom';
import { useNewInCourse } from '../hooks/useCanvasData';
import { t } from '../i18n';

// Per-course sub-navigation. Add a tab here when a course gets a new section.
export function CourseTabs({ courseId }: { courseId: number }) {
  const { pathname } = useLocation();
  const fresh = useNewInCourse(courseId);
  const base = `/courses/${courseId}`;
  const tabs = [
    // Pages is the course's default tab (the bare course URL).
    { to: base, label: t('Pages'), active: pathname === base || pathname.startsWith(`${base}/pages`) },
    // The assignment detail page lives under this tab too, so it stays highlighted there.
    { to: `${base}/assignments`, label: t('Assignments'), active: pathname.startsWith(`${base}/assignments`), fresh: fresh.assignments },
    { to: `${base}/announcements`, label: t('Announcements'), active: pathname.startsWith(`${base}/announcements`), fresh: fresh.announcements },
    { to: `${base}/files`, label: t('Files by unit'), active: pathname.startsWith(`${base}/files`) },
    { to: `${base}/grades`, label: t('Grades'), active: pathname.startsWith(`${base}/grades`) },
    { to: `${base}/export`, label: t('AI export'), active: pathname.startsWith(`${base}/export`) },
  ] as Array<{ to: string; label: string; active: boolean; fresh?: number }>;
  return (
    <nav className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
            tab.active
              ? 'border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-300'
              : 'border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
          }`}
        >
          {tab.label}
          {/* Something new since the student last opened this tab (see lib/seen.ts). */}
          {!!tab.fresh && (
            <>
              <span aria-hidden className="h-2 w-2 rounded-full bg-accent-600 dark:bg-accent-400" />
              <span className="sr-only">{t('{n} new', { n: tab.fresh })}</span>
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}

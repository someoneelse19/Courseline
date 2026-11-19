import { Link, useLocation } from 'react-router-dom';
import { useAssignments, useCourseTabs, useNewInCourse } from '../hooks/useCanvasData';
import { externalTools, isQuiz } from '../lib/canvasTab';
import { t } from '../i18n';

// Per-course sub-navigation. Add a tab here when a course gets a new section.
export function CourseTabs({ courseId }: { courseId: number }) {
  const { pathname } = useLocation();
  const fresh = useNewInCourse(courseId);
  const menu = useCourseTabs(courseId);
  const base = `/courses/${courseId}`;
  // Discussions only when the course's Canvas menu has it. When the menu cannot be read (extension mode) the tab stays.
  const discussions = menu.data ? menu.data.some((tab) => tab.id === 'discussions') : !!menu.error;
  // Tools: the course's quizzes and the external tools in its Canvas menu (attendance…), when it has any.
  const assignments = useAssignments(courseId);
  const tools = externalTools(menu.data ?? []).length > 0 || !!assignments.data?.some(isQuiz);
  const tabs = [
    // Pages is the course's default tab (the bare course URL).
    { to: base, label: t('Pages'), active: pathname === base || pathname.startsWith(`${base}/pages`) },
    // The assignment detail page lives under this tab too, so it stays highlighted there.
    { to: `${base}/assignments`, label: t('Assignments'), active: pathname.startsWith(`${base}/assignments`), fresh: fresh.assignments },
    { to: `${base}/announcements`, label: t('Announcements'), active: pathname.startsWith(`${base}/announcements`), fresh: fresh.announcements },
    ...(discussions ? [{ to: `${base}/discussions`, label: t('Discussions'), active: pathname.startsWith(`${base}/discussions`) }] : []),
    { to: `${base}/people`, label: t('People'), active: pathname.startsWith(`${base}/people`) },
    { to: `${base}/files`, label: t('Files'), active: pathname.startsWith(`${base}/files`) },
    { to: `${base}/grades`, label: t('Grades'), active: pathname.startsWith(`${base}/grades`), fresh: fresh.feedback },
    ...(tools ? [{ to: `${base}/tools`, label: t('Tools'), active: pathname.startsWith(`${base}/tools`) }] : []),
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
          {/* Something new since the student last opened this tab (see lib/seen.ts), or feedback not looked at yet (Grades). */}
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

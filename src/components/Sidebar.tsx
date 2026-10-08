import { Link, NavLink, useLocation } from 'react-router-dom';
import { useVisibleCourses } from '../hooks/useCanvasData';
import { CourseIcon, navIcons } from './icons';
import { Spinner } from './ui';
import { t } from '../i18n';

// Layout: Dashboard (+ cross-course views) at the top, your courses in the middle,
// Settings pinned to the bottom. Fixed column on desktop, slide-over drawer on mobile.
// TODO: add Inbox, Announcements here as features land.

const item = (active: boolean) =>
  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
    active
      ? 'bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300'
      : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
  }`;

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: courses, error } = useVisibleCourses();
  const { pathname } = useLocation();
  const currentCourseId = pathname.match(/^\/courses\/(\d+)/)?.[1];

  return (
    <>
      {/* Mobile backdrop */}
      {open && <div className="absolute inset-0 z-20 bg-black/40 md:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white transition-transform dark:border-neutral-800 dark:bg-neutral-900 md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          <NavLink to="/" end className={({ isActive }) => item(isActive)}>
            {navIcons.dashboard}
            <span className="truncate">{t('Dashboard')}</span>
          </NavLink>
          <NavLink to="/assignments" className={({ isActive }) => item(isActive)}>
            {navIcons.assignments}
            <span className="truncate">{t('All assignments')}</span>
          </NavLink>

          <NavLink to="/calendar" className={({ isActive }) => item(isActive)}>
            {navIcons.calendar}
            <span className="truncate">{t('Calendar')}</span>
          </NavLink>

          <h3 className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{t('Courses')}</h3>
          {error ? (
            <p className="px-3 text-xs text-red-600 dark:text-red-400">{t('Couldn’t load courses.')}</p>
          ) : !courses ? (
            <Spinner label="" />
          ) : courses.length === 0 ? (
            <p className="px-3 text-xs text-neutral-500 dark:text-neutral-400">
              {t('None selected.')} <Link to="/settings" className="underline">{t('Choose courses')}</Link>
            </p>
          ) : (
            courses.map((c) => (
              <Link key={c.id} to={`/courses/${c.id}`} title={c.name} className={item(currentCourseId === String(c.id))}>
                <CourseIcon courseId={c.id} />
                <span className="truncate">{c.name}</span>
              </Link>
            ))
          )}
        </nav>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <NavLink to="/settings" className={({ isActive }) => item(isActive)}>
            {navIcons.settings}
            <span className="truncate">{t('Settings')}</span>
          </NavLink>
        </div>
      </aside>
    </>
  );
}

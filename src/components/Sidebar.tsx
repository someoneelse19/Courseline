import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useVisibleCourses } from '../hooks/useCanvasData';
import { Spinner } from './ui';

// Layout: Dashboard (+ cross-course views) at the top, your courses in the middle,
// Settings pinned to the bottom. Fixed column on desktop, slide-over drawer on mobile.
// TODO: add Calendar, Inbox, Announcements here as features land.

// Inline 24px stroke icons (no icon library); they inherit the link's text color.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const icons = {
  dashboard: (
    <Icon>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </Icon>
  ),
  assignments: (
    <Icon>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Icon>
  ),
  course: (
    <Icon>
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 19V5M9 7h6" />
    </Icon>
  ),
  settings: (
    <Icon>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Icon>
  ),
};

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
            {icons.dashboard}
            <span className="truncate">Dashboard</span>
          </NavLink>
          <NavLink to="/assignments" className={({ isActive }) => item(isActive)}>
            {icons.assignments}
            <span className="truncate">All assignments</span>
          </NavLink>

          <h3 className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Courses</h3>
          {error ? (
            <p className="px-3 text-xs text-red-600 dark:text-red-400">Couldn’t load courses.</p>
          ) : !courses ? (
            <Spinner label="" />
          ) : courses.length === 0 ? (
            <p className="px-3 text-xs text-neutral-500 dark:text-neutral-400">
              None selected. <Link to="/settings" className="underline">Choose courses</Link>
            </p>
          ) : (
            courses.map((c) => (
              <Link key={c.id} to={`/courses/${c.id}`} title={c.name} className={item(currentCourseId === String(c.id))}>
                {icons.course}
                <span className="truncate">{c.name}</span>
              </Link>
            ))
          )}
        </nav>

        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <NavLink to="/settings" className={({ isActive }) => item(isActive)}>
            {icons.settings}
            <span className="truncate">Settings</span>
          </NavLink>
        </div>
      </aside>
    </>
  );
}

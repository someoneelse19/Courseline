import { Link, useLocation } from 'react-router-dom';

// Per-course sub-navigation. Add a tab here when a course gets a new section.
export function CourseTabs({ courseId }: { courseId: number }) {
  const { pathname } = useLocation();
  const base = `/courses/${courseId}`;
  const tabs = [
    // Pages is the course's default tab (the bare course URL).
    { to: base, label: 'Pages', active: pathname === base || pathname.startsWith(`${base}/pages`) },
    // The assignment detail page lives under this tab too, so it stays highlighted there.
    { to: `${base}/assignments`, label: 'Assignments', active: pathname.startsWith(`${base}/assignments`) },
    { to: `${base}/files`, label: 'Files by unit', active: pathname.startsWith(`${base}/files`) },
    { to: `${base}/grades`, label: 'Grades', active: pathname.startsWith(`${base}/grades`) },
  ];
  return (
    <nav className="mb-4 flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            t.active
              ? 'border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-300'
              : 'border-transparent text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

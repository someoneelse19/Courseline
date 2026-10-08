import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// Which courses the user wants to see. `null` = no filter (show everything).
// Persisted in localStorage. Applied by useVisibleCourses() and the dashboard's
// upcoming list; the Settings page edits it against the full course list.
// Note: courses added to Canvas later stay hidden once a selection exists.
const STORAGE_KEY = 'better-canvas.selected-courses';

interface CourseFilterValue {
  selected: ReadonlySet<number> | null;
  setSelected: (ids: Iterable<number> | null) => void;
  isVisible: (courseId: number | null) => boolean;
}

function load(): Set<number> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as number[]);
  } catch {
    /* corrupt or unavailable storage → no filter */
  }
  return null;
}

const CourseFilterContext = createContext<CourseFilterValue | null>(null);

export function CourseFilterProvider({ children }: { children: ReactNode }) {
  const [selected, setState] = useState<Set<number> | null>(load);

  const setSelected = useCallback((ids: Iterable<number> | null) => {
    const next = ids === null ? null : new Set(ids);
    setState(next);
    try {
      if (next === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<CourseFilterValue>(
    () => ({
      selected,
      setSelected,
      // null ids (non-course calendar items) are never filtered out.
      isVisible: (id) => selected === null || id === null || selected.has(id),
    }),
    [selected, setSelected],
  );

  return <CourseFilterContext.Provider value={value}>{children}</CourseFilterContext.Provider>;
}

export function useCourseFilter(): CourseFilterValue {
  const ctx = useContext(CourseFilterContext);
  if (!ctx) throw new Error('useCourseFilter must be used inside <CourseFilterProvider>');
  return ctx;
}

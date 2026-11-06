import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

// Which courses the user wants to see. `null` = no filter (show everything).
// Persisted in localStorage. Applied by useVisibleCourses() and the dashboard's
// upcoming list; the Settings page edits it against the full course list.
// Note: courses added to Canvas later stay hidden once a selection exists.
// Also the order the user put their courses in (Settings → Courses), applied by useVisibleCourses().
const STORAGE_KEY = 'courseline.selected-courses';
const ORDER_KEY = 'courseline.course-order';

interface CourseFilterValue {
  selected: ReadonlySet<number> | null;
  setSelected: (ids: Iterable<number> | null) => void;
  isVisible: (courseId: number | null) => boolean;
  /** Course ids in the order the user chose; null = Canvas's own order. */
  order: readonly number[] | null;
  setOrder: (ids: number[] | null) => void;
}

/** `list` in the user's order: the courses they placed first, in that order, then any others as they came. */
export function orderCourses<T extends { id: number }>(list: T[], order: readonly number[] | null): T[] {
  if (!order?.length) return list;
  const rank = new Map(order.map((id, i) => [id, i] as const));
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (rank.get(a.c.id) ?? order.length + a.i) - (rank.get(b.c.id) ?? order.length + b.i))
    .map((x) => x.c);
}

function loadOrder(): number[] | null {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(ids) && ids.every((x) => Number.isInteger(x)) ? (ids as number[]) : null;
  } catch {
    return null;
  }
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
  const [order, setOrderState] = useState<number[] | null>(loadOrder);

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

  const setOrder = useCallback((ids: number[] | null) => {
    setOrderState(ids);
    try {
      if (ids === null) localStorage.removeItem(ORDER_KEY);
      else localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
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
      order,
      setOrder,
    }),
    [selected, setSelected, order, setOrder],
  );

  return <CourseFilterContext.Provider value={value}>{children}</CourseFilterContext.Provider>;
}

/** Like useCourseFilter, but null instead of throwing when there is no provider (the login page is outside it). */
export function useOptionalCourseFilter(): CourseFilterValue | null {
  return useContext(CourseFilterContext);
}

export function useCourseFilter(): CourseFilterValue {
  const ctx = useContext(CourseFilterContext);
  if (!ctx) throw new Error('useCourseFilter must be used inside <CourseFilterProvider>');
  return ctx;
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { isHex } from '../lib/accent';
import { isIconKey, type CourseIconKey } from '../lib/courseIcons';

// The user's own color / icon for each course, overriding the automatic ones. Kept in
// localStorage; a course with no entry uses the automatic color (lib/courseColor.ts) and the book icon.
const STORAGE_KEY = 'courseline.course-styles';

export interface CourseStyle {
  color?: string; // #rrggbb
  icon?: CourseIconKey;
}
type Styles = Record<number, CourseStyle>;

interface CourseStyleValue {
  styles: Styles;
  /** Merge a change into one course's style. */
  setStyle: (courseId: number, patch: CourseStyle) => void;
  /** Back to the automatic color and icon. */
  reset: (courseId: number) => void;
}

function load(): Styles {
  const out: Styles = {};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, { color?: unknown; icon?: unknown }>;
    for (const [id, s] of Object.entries(raw)) {
      const style: CourseStyle = {};
      if (isHex(s?.color)) style.color = s.color.toLowerCase();
      if (isIconKey(s?.icon)) style.icon = s.icon;
      if (style.color || style.icon) out[Number(id)] = style;
    }
  } catch {
    /* corrupt or unavailable storage → automatic styles */
  }
  return out;
}

const CourseStyleContext = createContext<CourseStyleValue | null>(null);

export function CourseStyleProvider({ children }: { children: ReactNode }) {
  const [styles, setState] = useState<Styles>(load);

  const commit = useCallback((next: Styles) => {
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const setStyle = useCallback((id: number, patch: CourseStyle) => commit({ ...styles, [id]: { ...styles[id], ...patch } }), [styles, commit]);
  const reset = useCallback(
    (id: number) => {
      const { [id]: _removed, ...rest } = styles;
      commit(rest);
    },
    [styles, commit],
  );

  const value = useMemo(() => ({ styles, setStyle, reset }), [styles, setStyle, reset]);
  return <CourseStyleContext.Provider value={value}>{children}</CourseStyleContext.Provider>;
}

export function useCourseStyles(): CourseStyleValue {
  const ctx = useContext(CourseStyleContext);
  if (!ctx) throw new Error('useCourseStyles must be used inside <CourseStyleProvider>');
  return ctx;
}

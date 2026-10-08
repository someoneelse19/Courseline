import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyAccent, isHex } from '../lib/accent';

type Theme = 'light' | 'dark';

interface ThemeValue {
  theme: Theme;
  toggle: () => void;
  /** Custom accent color as #rrggbb, or null for the default. */
  accent: string | null;
  setAccent: (hex: string | null) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const ACCENT_KEY = 'better-canvas.accent';
// Computed palette, so the inline script in index.html can apply it before first paint.
const ACCENT_VARS_KEY = 'better-canvas.accent-vars';

function initialAccent(): string | null {
  try {
    const saved = localStorage.getItem(ACCENT_KEY);
    return isHex(saved) ? saved : null;
  } catch {
    return null;
  }
}

// Keep in sync with the inline script in index.html (prevents a flash on load).
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [accent, setAccent] = useState<string | null>(initialAccent);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    const vars = applyAccent(accent);
    try {
      if (accent) localStorage.setItem(ACCENT_KEY, accent);
      else localStorage.removeItem(ACCENT_KEY);
      if (vars) localStorage.setItem(ACCENT_VARS_KEY, JSON.stringify(vars));
      else localStorage.removeItem(ACCENT_VARS_KEY);
    } catch {
      /* ignore */
    }
  }, [accent]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ theme, toggle, accent, setAccent }), [theme, toggle, accent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { Module, Page } from '../api/types';
import { HtmlContent } from '../components/HtmlContent';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useCourseFiles, useModules, usePages } from '../hooks/useCanvasData';
import { UnitItems } from './CourseFilesPage';

// The "Pages" tab: a course's content however the teacher built it. Units (modules) and
// wiki pages are shown side by side as collapsible, reorderable sections, so a course
// built from pages and one built from modules look the same here.
// Order + collapsed state are per-course UI preferences, kept in localStorage.

type Section = { key: string; title: string; html_url?: string } & ({ kind: 'page'; page: Page } | { kind: 'module'; module: Module });

interface Prefs {
  order: string[]; // section keys, in the user's order
  collapsed: string[];
}

const storageKey = (courseId: number) => `better-canvas.pages.${courseId}`;

function loadPrefs(courseId: number): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(courseId)) ?? '{}');
    return {
      order: Array.isArray(raw.order) ? raw.order : [],
      collapsed: Array.isArray(raw.collapsed) ? raw.collapsed : [],
    };
  } catch {
    return { order: [], collapsed: [] };
  }
}

export function CoursePagesPage() {
  const courseId = Number(useParams().courseId);
  const { baseUrl } = useAuth();
  const pages = usePages(courseId);
  const modules = useModules(courseId);
  const files = useCourseFiles(courseId);
  const [prefs, setPrefs] = useState(() => loadPrefs(courseId));

  // Units first (course structure), then pages; the user's saved order wins over both.
  const sections = useMemo<Section[]>(() => {
    const units: Section[] = (modules.data ?? [])
      .filter((m) => (m.items ?? []).length > 0)
      .map((m) => ({ key: `module:${m.id}`, title: m.name, kind: 'module', module: m }));
    const pgs: Section[] = (pages.data ?? []).map((p) => ({
      key: p.url ?? String(p.page_id),
      title: p.title ?? p.url ?? 'Untitled page',
      html_url: p.html_url,
      kind: 'page',
      page: p,
    }));
    const rank = new Map(prefs.order.map((k, i) => [k, i]));
    return [...units, ...pgs]
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (rank.get(a.s.key) ?? Infinity) - (rank.get(b.s.key) ?? Infinity) || a.i - b.i)
      .map((x) => x.s);
  }, [modules.data, pages.data, prefs.order]);

  const fileById = useMemo(() => new Map((files.data ?? []).map((f) => [f.id, f])), [files.data]);
  const fileHref = (fileId: number, moduleItemId?: number) =>
    baseUrl ? `${baseUrl}/courses/${courseId}/files/${fileId}${moduleItemId ? `?module_item_id=${moduleItemId}` : ''}` : undefined;

  // Either source can legitimately be unavailable (hidden Pages tab, no modules); only fail if both are.
  if (pages.error && modules.error) return <ErrorMessage error={pages.error} onRetry={() => (pages.refetch(), modules.refetch())} />;
  if ((!pages.data && !pages.error) || (!modules.data && !modules.error)) return <Spinner />;
  if (sections.length === 0) return <EmptyState>No pages or units found for this course.</EmptyState>;

  const save = (next: Prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(storageKey(courseId), JSON.stringify(next));
    } catch {
      // private mode / storage full: the change still applies for this session
    }
  };

  const keys = sections.map((s) => s.key);
  const move = (index: number, delta: -1 | 1) => {
    const next = [...keys];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    save({ ...prefs, order: next });
  };
  const toggle = (key: string) =>
    save({ ...prefs, collapsed: prefs.collapsed.includes(key) ? prefs.collapsed.filter((k) => k !== key) : [...prefs.collapsed, key] });
  const allCollapsed = keys.every((k) => prefs.collapsed.includes(k));

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => save({ ...prefs, collapsed: allCollapsed ? [] : keys })}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      </div>
      <div className="space-y-4">
        {sections.map((s, i) => (
          <SectionCard
            key={s.key}
            title={s.title}
            htmlUrl={s.html_url}
            badge={s.kind === 'module' ? (s.module.items ?? []).filter((it) => it.type !== 'SubHeader').length : undefined}
            collapsed={prefs.collapsed.includes(s.key)}
            onToggle={() => toggle(s.key)}
            onUp={i > 0 ? () => move(i, -1) : undefined}
            onDown={i < sections.length - 1 ? () => move(i, 1) : undefined}
          >
            {s.kind === 'page' ? (
              s.page.body ? <HtmlContent html={s.page.body} /> : <EmptyState>This page is empty.</EmptyState>
            ) : (
              <UnitItems items={s.module.items ?? []} courseId={courseId} fileById={fileById} fileHref={fileHref} />
            )}
          </SectionCard>
        ))}
      </div>
    </>
  );
}

function SectionCard({
  title,
  htmlUrl,
  badge,
  collapsed,
  onToggle,
  onUp,
  onDown,
  children,
}: {
  title: string;
  htmlUrl?: string;
  badge?: number;
  collapsed: boolean;
  onToggle: () => void;
  onUp?: () => void;
  onDown?: () => void;
  children: ReactNode;
}) {
  const arrow = 'rounded-sm px-2 py-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800';
  return (
    <Card>
      <div className="flex items-center gap-2">
        <button onClick={onToggle} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span aria-hidden className={`text-xs text-neutral-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}>▼</span>
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {badge !== undefined && <span className="text-sm text-neutral-500 dark:text-neutral-400">· {badge}</span>}
        </button>
        {htmlUrl && (
          <a href={htmlUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-accent-600 hover:underline dark:text-accent-400">
            Open in Canvas ↗
          </a>
        )}
        <button onClick={onUp} disabled={!onUp} aria-label={`Move ${title} up`} className={arrow}>↑</button>
        <button onClick={onDown} disabled={!onDown} aria-label={`Move ${title} down`} className={arrow}>↓</button>
      </div>
      {!collapsed && <div className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">{children}</div>}
    </Card>
  );
}

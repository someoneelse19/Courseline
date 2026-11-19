import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ModuleItem, Page } from '../api/types';
import { AssignmentList } from '../components/AssignmentList';
import { HtmlContent } from '../components/HtmlContent';
import { CourseIcon } from '../components/icons';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { usePull } from '../context/PullContext';
import { API_ONLY } from '../edition';
import { useAssignments, useCommunityNews, useCourse, useCourseColors, useCourseFiles, useDiscussions, useModules, usePages } from '../hooks/useCanvasData';
import { useCourseKinds, useFreshOnOpen, useHiddenCommunities } from '../lib/communities';
import { Topic } from './CourseAnnouncementsPage';
import { UnitItems } from './CourseFilesPage';
import { t } from '../i18n';

// One community, on one page. A class is split into tabs (assignments, grades, files…) because each is a different job;
// a community is mostly read top to bottom: what it posted, what it keeps for you, where people talk. Sections it does
// not use are left out rather than shown empty, and there is no grade. The full course view stays one click away.

const NEWS_FIRST = 3;
const FILTER_FROM = 6;
const NO_HIDDEN: ReadonlySet<number> = new Set();

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

function News({ courseId }: { courseId: number }) {
  const ids = useMemo(() => [courseId], [courseId]);
  const news = useCommunityNews(ids);
  const fresh = useFreshOnOpen(news.data, NO_HIDDEN);
  const [all, setAll] = useState(false);
  const posts = news.data?.[0]?.posts;

  if (news.data && posts === null) return null; // not synced, or the school hides it: the page says so once, below
  return (
    <Card title={t('News')}>
      {!posts ? (
        <Spinner />
      ) : posts.length === 0 ? (
        <EmptyState>{t('No posts yet.')}</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {(all ? posts : posts.slice(0, NEWS_FIRST)).map((p) => (
              <Topic key={p.id} topic={p} fresh={!!fresh?.has(`${courseId}:${p.id}`)} />
            ))}
          </ul>
          {!all && posts.length > NEWS_FIRST && (
            <button onClick={() => setAll(true)} className="mt-2 text-sm text-accent-700 hover:underline dark:text-accent-300">
              {t('Show all ({n})', { n: posts.length })}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

type Group = { key: string; title: string; open: boolean } & ({ kind: 'page'; page: Page } | { kind: 'unit'; items: ModuleItem[] });

const matches = (text: string | undefined, needle: string) => !!text && text.toLocaleLowerCase().includes(needle);

/** The community's home page, then its units and other pages, as one searchable list. */
function Resources({ courseId, groups }: { courseId: number; groups: Group[] }) {
  const files = useCourseFiles(courseId);
  const fileById = useMemo(() => new Map((files.data ?? []).map((f) => [f.id, f])), [files.data]);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();

  // A group whose title matches stays whole; otherwise only its matching entries are kept.
  const shown = useMemo(() => {
    if (!needle) return groups;
    return groups.flatMap((g): Group[] => {
      if (matches(g.title, needle)) return [{ ...g, open: true }];
      if (g.kind === 'unit') {
        const items = g.items.filter((it) => it.type !== 'SubHeader' && matches(it.title, needle));
        return items.length ? [{ ...g, items, open: true }] : [];
      }
      return matches(g.page.body, needle) ? [{ ...g, open: true }] : [];
    });
  }, [groups, needle]);

  return (
    <Card title={t('Resources')}>
      {groups.length >= FILTER_FROM && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search resources')}
          aria-label={t('Search resources')}
          className="mb-3 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      )}
      {shown.length === 0 ? (
        <EmptyState>{t('Nothing matches “{query}”.', { query: query.trim() })}</EmptyState>
      ) : (
        <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {shown.map((g) => (
            // Keyed on the search too, so a search opens what it found and clearing it restores the defaults.
            <details key={`${g.key}:${needle}`} open={g.open} className="py-2">
              <summary className="cursor-pointer font-medium">{g.title}</summary>
              <div className="mt-2">
                {g.kind === 'page' ? (
                  g.page.body ? <HtmlContent html={g.page.body} /> : <EmptyState>{t('This page is empty.')}</EmptyState>
                ) : (
                  <UnitItems items={g.items} courseId={courseId} fileById={fileById} />
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

function Header({ courseId, name, children }: { courseId: number; name: string; children: ReactNode }) {
  const colorOf = useCourseColors();
  return (
    <header className="mb-6 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-3 px-4 py-5 text-white" style={{ backgroundColor: colorOf(courseId) }}>
        <CourseIcon courseId={courseId} className="h-8 w-8 opacity-90" />
        <h1 className="text-xl font-bold tracking-tight">{name}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">{children}</div>
    </header>
  );
}

const action = 'text-accent-700 hover:underline disabled:opacity-50 dark:text-accent-300';

export function CommunityPage() {
  const courseId = Number(useParams().courseId);
  const course = useCourse(courseId);
  const pages = usePages(courseId);
  const modules = useModules(courseId);
  const discussions = useDiscussions(courseId);
  const assignments = useAssignments(courseId);
  const news = useCommunityNews(useMemo(() => [courseId], [courseId]));
  const { hidden, setHidden } = useHiddenCommunities();
  const { setKind } = useCourseKinds();
  const navigate = useNavigate();
  const { source, baseUrl } = useAuth();
  const pull = usePull();

  // The home page first and open (it is usually the community's welcome and main links), then units, then pages.
  const groups = useMemo<Group[]>(() => {
    const list = pages.data ?? [];
    const home = list.filter((p) => p.front_page);
    const units: Group[] = (modules.data ?? [])
      .filter((m) => (m.items ?? []).length > 0)
      .map((m) => ({ key: `unit:${m.id}`, title: m.name, open: false, kind: 'unit', items: m.items ?? [] }));
    const toGroup = (p: Page, open: boolean): Group => ({ key: `page:${p.url ?? p.page_id}`, title: p.title ?? p.url ?? t('Untitled page'), open, kind: 'page', page: p });
    return [...home.map((p) => toGroup(p, true)), ...units, ...list.filter((p) => !p.front_page).map((p) => toGroup(p, false))];
  }, [pages.data, modules.data]);

  const topics = useMemo(
    () => [...(discussions.data ?? [])].sort((a, b) => time(b.last_reply_at ?? b.posted_at) - time(a.last_reply_at ?? a.posted_at)),
    [discussions.data],
  );

  if (course.error) return <ErrorMessage error={course.error} onRetry={course.refetch} />;
  if (!course.data) return <Spinner />;

  const name = course.data.name ?? t('Course {id}', { id: courseId });
  const isHidden = hidden.has(courseId);
  const canSync = !API_ONLY && source === 'extension';
  // Each part may be missing (the school hides a tab, or nothing was synced). Wait until all have answered.
  const settled = [pages, modules, discussions, assignments, news].every((q) => q.data !== undefined || q.error);
  const hasNews = !!news.data?.[0]?.posts;
  const nothing = settled && !hasNews && groups.length === 0 && topics.length === 0 && !assignments.data?.length;

  return (
    <>
      <Header courseId={courseId} name={name}>
        <Link to="/communities" className={action}>← {t('Communities')}</Link>
        {baseUrl && (
          <a href={`${baseUrl}/courses/${courseId}`} target="_blank" rel="noreferrer" className={action}>
            {t('Open in Canvas ↗')}
          </a>
        )}
        {canSync && (
          <button onClick={() => pull.syncCommunities([{ id: courseId, name }])} disabled={pull.running} className={action}>
            {t('Sync')}
          </button>
        )}
        <button onClick={() => setHidden(courseId, !isHidden)} className={action}>
          {isHidden ? t('Show in feed') : t('Hide from feed')}
        </button>
        <button
          onClick={() => {
            setKind(courseId, 'class');
            navigate('/communities');
          }}
          className="ml-auto text-xs text-neutral-500 hover:underline dark:text-neutral-400"
        >
          {t('Not a community')}
        </button>
        <Link to={`/courses/${courseId}`} className="text-xs text-neutral-500 hover:underline dark:text-neutral-400">
          {t('Course view')}
        </Link>
      </Header>

      {nothing ? (
        <EmptyState>
          {canSync ? t('Nothing from this community has been synced yet. Sync it to read it here.') : t('This community has nothing to show yet.')}
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <News courseId={courseId} />
          {groups.length > 0 && <Resources courseId={courseId} groups={groups} />}
          {topics.length > 0 && (
            <Card title={t('Discussions')}>
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {topics.map((topic) => (
                  <Topic key={topic.id} topic={topic} />
                ))}
              </ul>
            </Card>
          )}
          {!!assignments.data?.length && (
            <Card title={t('Activities')}>
              <AssignmentList assignments={assignments.data} />
            </Card>
          )}
          {!settled && <Spinner />}
        </div>
      )}
    </>
  );
}

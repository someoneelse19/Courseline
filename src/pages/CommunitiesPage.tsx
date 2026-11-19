import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Course } from '../api/types';
import { CourseIcon } from '../components/icons';
import { Card, EmptyState, ErrorMessage, PageTitle, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { usePull } from '../context/PullContext';
import { API_ONLY } from '../edition';
import { useCommunities, useCommunityNews, useCourseColors } from '../hooks/useCanvasData';
import { buildFeed, lastPostAt, useCourseKinds, useFreshOnOpen, useHiddenCommunities, type CommunityNews } from '../lib/communities';
import { formatDay } from '../lib/format';
import { Topic } from './CourseAnnouncementsPage';
import { t, tn } from '../i18n';

// The communities hub. Canvas shows communities as a grid of course cards you open one by one to find out whether
// anything happened; here the news from all of them is one feed, and the directory says which have new posts.

const PAGE = 15;

/** The community's color and name, linking to it. */
export function CommunityChip({ course }: { course: Pick<Course, 'id' | 'name'> }) {
  const colorOf = useCourseColors();
  return (
    <Link to={`/communities/${course.id}`} className="inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-neutral-600 hover:underline dark:text-neutral-300">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(course.id) }} aria-hidden />
      <span className="truncate">{course.name}</span>
    </Link>
  );
}

function DirectoryRow({ course, news, fresh }: { course: Course; news: CommunityNews | undefined; fresh: number }) {
  const last = lastPostAt(news?.posts ?? null);
  const sub = !news ? '' : news.posts === null ? t('Not synced yet') : last ? t('Last post {date}', { date: formatDay(new Date(last).toISOString()) }) : t('No posts yet');
  return (
    <li>
      <Link to={`/communities/${course.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        <CourseIcon courseId={course.id} className="h-5 w-5" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{course.name}</span>
          {sub && <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">{sub}</span>}
        </span>
        {fresh > 0 && (
          <span className="min-w-5 rounded-full bg-accent-600 px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
            <span aria-hidden>{fresh}</span>
            <span className="sr-only">{tn(fresh, '{n} new post', '{n} new posts')}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Classes the student is enrolled in that are not in their course list (next semester's, usually): not communities,
 * so kept out of the feed, but listed so they are easy to find, with "It's a community" for a wrong guess.
 */
function OtherClasses({ classes }: { classes: Course[] }) {
  const { setKind } = useCourseKinds();
  if (!classes.length) return null;
  return (
    <Card>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">{t('Classes not in your list ({n})', { n: classes.length })}</summary>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          {t('Classes you are enrolled in, like next semester’s, that are not among your courses.')}{' '}
          <Link to="/settings?tab=courses" className="underline">{t('Choose courses')}</Link>
        </p>
        <ul className="-mx-2 mt-2">
          {classes.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <Link to={`/courses/${c.id}`} className="min-w-0 flex-1 truncate text-sm">{c.name}</Link>
              <button onClick={() => setKind(c.id, 'community')} className="shrink-0 text-xs text-accent-700 hover:underline dark:text-accent-300">
                {t('It’s a community')}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

export function CommunitiesPage() {
  const communities = useCommunities();
  const ids = useMemo(() => (communities.data ?? []).map((c) => c.id), [communities.data]);
  const news = useCommunityNews(ids);
  const { hidden } = useHiddenCommunities();
  const fresh = useFreshOnOpen(news.data, hidden);
  const { source } = useAuth();
  const pull = usePull();
  const [shown, setShown] = useState(PAGE);

  const byId = useMemo(() => new Map((communities.data ?? []).map((c) => [c.id, c])), [communities.data]);
  const newsById = useMemo(() => new Map((news.data ?? []).map((n) => [n.courseId, n])), [news.data]);
  const feed = useMemo(() => (news.data ? buildFeed(news.data, hidden, fresh) : undefined), [news.data, hidden, fresh]);
  const freshIn = (courseId: number) => (feed ?? []).filter((i) => i.courseId === courseId && i.fresh).length;

  // Most recently active first: the directory is where you go to look one up.
  const [active, muted] = useMemo(() => {
    const list = [...(communities.data ?? [])].sort((a, b) => lastPostAt(newsById.get(b.id)?.posts ?? null) - lastPostAt(newsById.get(a.id)?.posts ?? null));
    return [list.filter((c) => !hidden.has(c.id)), list.filter((c) => hidden.has(c.id))];
  }, [communities.data, newsById, hidden]);

  const canSync = !API_ONLY && source === 'extension' && !!communities.data?.length;
  const syncAll = () => pull.syncCommunities(active.map((c) => ({ id: c.id, name: c.name ?? null })));
  const unsynced = (news.data ?? []).filter((n) => n.posts === null && !hidden.has(n.courseId)).length;

  if (communities.error) return <ErrorMessage error={communities.error} onRetry={communities.refetch} />;
  if (!communities.data) return <Spinner />;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTitle>{t('Communities')}</PageTitle>
        {canSync && (
          <button onClick={syncAll} disabled={pull.running} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
            {t('Sync communities')}
          </button>
        )}
      </div>

      {communities.data.length === 0 ? (
        <>
          <EmptyState>{t('No communities. Spaces you belong to besides your classes, like the library or student life, show up here.')}</EmptyState>
          <OtherClasses classes={communities.otherClasses ?? []} />
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title={t('Latest news')} className="lg:col-span-2">
            {!feed ? (
              <Spinner />
            ) : feed.length === 0 ? (
              <EmptyState>
                {unsynced && canSync ? t('Nothing synced from your communities yet. Sync them to see their news here.') : t('Your communities have not posted anything yet.')}
              </EmptyState>
            ) : (
              <>
                <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {feed.slice(0, shown).map((item) => (
                    <Topic
                      key={`${item.courseId}:${item.post.id}`}
                      topic={item.post}
                      fresh={item.fresh}
                      context={byId.has(item.courseId) && <CommunityChip course={byId.get(item.courseId)!} />}
                    />
                  ))}
                </ul>
                {feed.length > shown && (
                  <button onClick={() => setShown((n) => n + PAGE)} className="mt-2 text-sm text-accent-700 hover:underline dark:text-accent-300">
                    {t('Show more')}
                  </button>
                )}
              </>
            )}
          </Card>

          <div className="space-y-6">
          <Card title={t('Your communities')}>
            <ul className="-mx-2">
              {active.map((c) => (
                <DirectoryRow key={c.id} course={c} news={newsById.get(c.id)} fresh={freshIn(c.id)} />
              ))}
            </ul>
            {active.length === 0 && <EmptyState>{t('You have hidden all of them.')}</EmptyState>}
            {muted.length > 0 && (
              <details className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
                <summary className="cursor-pointer text-xs text-neutral-500 dark:text-neutral-400">{t('Hidden ({n})', { n: muted.length })}</summary>
                <ul className="-mx-2 mt-1 opacity-70">
                  {muted.map((c) => (
                    <DirectoryRow key={c.id} course={c} news={newsById.get(c.id)} fresh={0} />
                  ))}
                </ul>
              </details>
            )}
          </Card>
          <OtherClasses classes={communities.otherClasses ?? []} />
          </div>
        </div>
      )}
    </>
  );
}

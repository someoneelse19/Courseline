import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { DiscussionTopic } from '../api/types';
import { HtmlContent } from '../components/HtmlContent';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAnnouncements, useDiscussions } from '../hooks/useCanvasData';
import { formatDue } from '../lib/format';
import { htmlText } from '../lib/html';
import { useIsNewPost, useMarkPostsRead } from '../hooks/useReadState';
import { t, tn } from '../i18n';

// Per-course announcements (what the instructor posted) and, on their own tab, discussions (conversations). Messages
// are instructor-written HTML, so they go through HtmlContent. Replies are not loaded here: "Open in Canvas" goes to them.

/**
 * One announcement or discussion: title, author and date, and a short preview; opening it swaps the preview for the full
 * message in its own panel, so the start of the text is not shown twice. `context` goes above the title (the community
 * a post comes from, in the communities feed).
 */
export function Topic({ topic, fresh = false, context }: { topic: DiscussionTopic; fresh?: boolean; context?: ReactNode }) {
  const preview = useMemo(() => htmlText(topic.message ?? '').slice(0, 140), [topic.message]);
  return (
    <li className="py-3">
      {context}
      <details className="group">
        <summary className="flex cursor-pointer list-none gap-2 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="mt-1 text-[10px] text-neutral-400 transition-transform group-open:rotate-90">▶</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{topic.title}</span>
            {fresh && <span className="ml-2 rounded-full bg-accent-600 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-white">{t('New')}</span>}
            <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
              {[topic.author?.display_name, topic.posted_at ? formatDue(topic.posted_at) : null].filter(Boolean).join(' · ')}
            </span>
            {preview && <p className="mt-0.5 line-clamp-2 text-sm text-neutral-600 group-open:hidden dark:text-neutral-300">{preview}</p>}
          </span>
        </summary>
        <div className="ml-5 mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-800/40">
          {topic.message ? <HtmlContent html={topic.message} /> : <EmptyState>{t('No message.')}</EmptyState>}
          <p className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            {typeof topic.discussion_subentry_count === 'number' && <span>{tn(topic.discussion_subentry_count, '{n} reply', '{n} replies')}</span>}
            {topic.html_url && (
              <a href={topic.html_url} target="_blank" rel="noreferrer" className="text-accent-700 underline dark:text-accent-300">
                {t('Open in Canvas ↗')}
              </a>
            )}
          </p>
        </div>
      </details>
    </li>
  );
}

function Section({ title, empty, query, fresh }: { title?: string; empty: string; query: ReturnType<typeof useAnnouncements>; fresh?: ReadonlySet<number> }) {
  return (
    <Card title={title}>
      {query.error ? (
        <ErrorMessage error={query.error} onRetry={query.refetch} />
      ) : !query.data ? (
        <Spinner />
      ) : query.data.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {query.data.map((topic) => (
            <Topic key={topic.id} topic={topic} fresh={fresh?.has(topic.id)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function CourseAnnouncementsPage() {
  const courseId = Number(useParams().courseId);
  const announcements = useAnnouncements(courseId);
  const isNewPost = useIsNewPost();
  const markPostsRead = useMarkPostsRead();
  // What was new when the tab opened keeps its "New" label for this visit; opening the tab marks it all read (in Canvas
  // too, with a token: the announcements are shown in full here).
  const [fresh, setFresh] = useState<ReadonlySet<number> | null>(null);
  useEffect(() => {
    if (!announcements.data || fresh) return;
    setFresh(new Set(announcements.data.filter((a) => isNewPost(courseId, a)).map((a) => a.id)));
    markPostsRead(courseId, announcements.data);
  }, [courseId, announcements.data, isNewPost, markPostsRead, fresh]);
  return <Section empty={t('No announcements.')} query={announcements} fresh={fresh ?? undefined} />;
}

/** The Discussions tab, shown only when the course's Canvas menu has Discussions (see CourseTabs). */
export function CourseDiscussionsPage() {
  const courseId = Number(useParams().courseId);
  return <Section empty={t('No discussions.')} query={useDiscussions(courseId)} />;
}

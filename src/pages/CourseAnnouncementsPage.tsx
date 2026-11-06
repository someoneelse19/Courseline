import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { DiscussionTopic } from '../api/types';
import { HtmlContent } from '../components/HtmlContent';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAnnouncements, useDiscussions } from '../hooks/useCanvasData';
import { formatDue } from '../lib/format';
import { htmlText } from '../lib/html';
import { isNew, markSeen, useSeen } from '../lib/seen';
import { t, tn } from '../i18n';

// Per-course announcements (what the instructor posted) and discussions (conversations). Messages are
// instructor-written HTML, so they go through HtmlContent. Replies are not loaded here: "Open in Canvas" goes to them.

function Topic({ topic, fresh = false }: { topic: DiscussionTopic; fresh?: boolean }) {
  const preview = useMemo(() => htmlText(topic.message ?? '').slice(0, 140), [topic.message]);
  return (
    <li className="py-3">
      <details>
        <summary className="cursor-pointer list-none">
          <span className="font-medium">{topic.title}</span>
          {fresh && <span className="ml-2 rounded-full bg-accent-600 px-1.5 py-0.5 align-middle text-[11px] font-semibold text-white">{t('New')}</span>}
          <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
            {[topic.author?.display_name, topic.posted_at ? formatDue(topic.posted_at) : null].filter(Boolean).join(' · ')}
          </span>
          {preview && <p className="mt-0.5 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">{preview}</p>}
        </summary>
        <div className="mt-2">
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

function Section({ title, empty, query, fresh }: { title: string; empty: string; query: ReturnType<typeof useAnnouncements>; fresh?: ReadonlySet<number> }) {
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
  const discussions = useDiscussions(courseId);
  const seen = useSeen(courseId, 'announcements');
  // What was new when the tab opened keeps its "New" label for this visit; opening the tab marks it all seen.
  const [fresh, setFresh] = useState<ReadonlySet<number> | null>(null);
  useEffect(() => {
    if (!announcements.data || fresh) return;
    setFresh(new Set(announcements.data.filter((a) => isNew({ ...a, date: a.posted_at }, seen)).map((a) => a.id)));
    markSeen(courseId, 'announcements', announcements.data.map((a) => a.id));
  }, [courseId, announcements.data, seen, fresh]);
  return (
    <div className="space-y-6">
      <Section title={t('Announcements')} empty={t('No announcements.')} query={announcements} fresh={fresh ?? undefined} />
      <Section title={t('Discussions')} empty={t('No discussions.')} query={discussions} />
    </div>
  );
}

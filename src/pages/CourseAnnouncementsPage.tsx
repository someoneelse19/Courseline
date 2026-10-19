import { useParams } from 'react-router-dom';
import type { DiscussionTopic } from '../api/types';
import { HtmlContent } from '../components/HtmlContent';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAnnouncements, useDiscussions } from '../hooks/useCanvasData';
import { formatDue } from '../lib/format';
import { htmlText } from '../lib/html';
import { t, tn } from '../i18n';

// Per-course announcements (what the instructor posted) and discussions (conversations). Messages are
// instructor-written HTML, so they go through HtmlContent. Replies are not loaded here: "Open in Canvas" goes to them.

function Topic({ topic }: { topic: DiscussionTopic }) {
  const preview = htmlText(topic.message ?? '').slice(0, 140);
  return (
    <li className="py-3">
      <details>
        <summary className="cursor-pointer list-none">
          <span className="font-medium">{topic.title}</span>
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

function Section({ title, empty, query }: { title: string; empty: string; query: ReturnType<typeof useAnnouncements> }) {
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
            <Topic key={topic.id} topic={topic} />
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
  return (
    <div className="space-y-6">
      <Section title={t('Announcements')} empty={t('No announcements.')} query={announcements} />
      <Section title={t('Discussions')} empty={t('No discussions.')} query={discussions} />
    </div>
  );
}

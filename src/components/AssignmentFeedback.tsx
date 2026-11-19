import { useMemo, useState, type FormEvent } from 'react';
import type { Assignment, ScoreStatistics, Submission, SubmissionComment } from '../api/types';
import { useApi, useAuth } from '../context/AuthContext';
import type { QueryResult } from '../hooks/useQuery';
import { formatDue } from '../lib/format';
import { htmlText } from '../lib/html';
import { Attachments } from './Attachments';
import { HtmlContent } from './HtmlContent';
import { Overlay, OverlayPanel } from './Overlay';
import { Card, EmptyState, ErrorMessage, Spinner } from './ui';
import { t } from '../i18n';

// What was handed in and the feedback on it: the "Your submission" and "Feedback" cards of the assignment page, also
// shown when an assignment is opened on the Grades screen. Which feedback is new comes from useOpenFeedback
// (hooks/useReadState.ts).

/** "Your submission": the grade (with the class's statistics) and what was handed in; a long one opens whole in an overlay. */
export function SubmissionCard({
  assignment: a,
  submission,
  sub,
  newGrade,
}: {
  assignment: Assignment;
  /** The full submission, as loading. */
  submission: QueryResult<Submission>;
  /** What to show: the full submission, or the one the assignment carries until it loads. */
  sub: Submission | undefined;
  newGrade?: boolean;
}) {
  return (
    <Card title={t('Your submission')}>
      {submission.error && !a.submission ? (
        <ErrorMessage error={submission.error} onRetry={submission.refetch} />
      ) : !sub && submission.loading ? (
        <Spinner />
      ) : (
        <SubmissionView sub={sub} points={a.points_possible} stats={a.score_statistics} newGrade={newGrade} />
      )}
    </Card>
  );
}

/** "Feedback": the comments on the submission, the new ones marked, and a reply box (with a token). */
export function FeedbackCard({
  courseId,
  assignmentId,
  comments,
  newCommentIds,
  readOnly,
  onSent,
}: {
  courseId: number;
  assignmentId: number;
  comments: SubmissionComment[];
  newCommentIds: ReadonlySet<number>;
  /** No reply box (the extension cannot write to Canvas). */
  readOnly: boolean;
  onSent: () => void;
}) {
  const { user } = useAuth();
  return (
    <Card title={newCommentIds.size > 0 ? `${t('Feedback')} · ${t('{n} new', { n: newCommentIds.size })}` : t('Feedback')}>
      {comments.length === 0 ? (
        <EmptyState>{t('No messages yet.')}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className={`text-sm ${newCommentIds.has(c.id) ? '-ml-3 border-l-2 border-accent-500 pl-2.5' : ''}`}>
              <p className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span>
                  {c.author_id === user?.id ? t('You') : c.author_name} · {formatDue(c.created_at)}
                </span>
                {newCommentIds.has(c.id) && <NewPill small>{t('New')}</NewPill>}
              </p>
              {/* Comments are plain text: whitespace-pre-wrap keeps line breaks, React escapes the rest. */}
              <p className="whitespace-pre-wrap">{c.comment}</p>
              {c.attachments?.length ? (
                <div className="mt-1.5">
                  <Attachments list={c.attachments} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <ReplyBox courseId={courseId} assignmentId={assignmentId} onSent={onSent} />}
    </Card>
  );
}

/** Posts a comment on your own submission (visible to your instructor). */
function ReplyBox({ courseId, assignmentId, onSent }: { courseId: number; assignmentId: number; onSent: () => void }) {
  const api = useApi();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !user) return;
    setSending(true);
    setError(null);
    try {
      await api.postSubmissionComment(courseId, assignmentId, user.id, text.trim());
      setText('');
      onSent(); // refetch so the new message appears
    } catch (err) {
      setError(err as Error);
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={send} className="mt-4 space-y-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t('Write a reply…')}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
      {error && <ErrorMessage error={error} />}
      <button
        disabled={sending || !text.trim()}
        className="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        {sending ? t('Sending…') : t('Reply')}
      </button>
    </form>
  );
}

export function SubmissionView({
  sub,
  points,
  stats,
  newGrade,
}: {
  sub: Submission | undefined;
  points: number | null;
  stats?: ScoreStatistics;
  newGrade?: boolean;
}) {
  const [full, setFull] = useState(false);
  const body = sub?.body ?? '';
  const bodyText = useMemo(() => (body ? htmlText(body) : ''), [body]);
  if (!sub || sub.workflow_state === 'unsubmitted') {
    return <EmptyState>{sub?.missing ? t('Marked missing.') : t('Nothing submitted yet.')}</EmptyState>;
  }

  const graded = sub.score != null;
  const isTruncated = bodyText.length > 300 || (sub.attachments?.length ?? 0) > 2;
  const truncatedBody = bodyText.slice(0, 300) + (bodyText.length > 300 ? '…' : '');

  return (
    <div className="space-y-3 text-sm">
      {graded && newGrade && <NewPill small>{t('New grade')}</NewPill>}
      {graded && <ScoreRing score={sub.score!} points={points} grade={sub.grade} />}
      {graded && stats && <ClassStats stats={stats} score={sub.score!} points={points} />}
      <p className="text-neutral-500 dark:text-neutral-400">
        {t('Submitted {date}', { date: formatDue(sub.submitted_at) })}
        {sub.late ? ` ${t('(late)')}` : ''}
        {sub.attempt ? ` · ${t('attempt {n}', { n: sub.attempt })}` : ''}
      </p>
      {!isTruncated && <SubmittedWork sub={sub} />}
      {isTruncated && (
        <>
          {truncatedBody && <p className="text-neutral-700 dark:text-neutral-300">{truncatedBody}</p>}
          {sub.attachments?.length ? <p className="text-neutral-600 dark:text-neutral-400">{t('+ {n} attachment(s)', { n: sub.attachments.length })}</p> : null}
          <button type="button" onClick={() => setFull(true)} className="text-accent-600 hover:underline dark:text-accent-400">
            {t('...view full submission')}
          </button>
        </>
      )}
      {full && (
        <Overlay onClose={() => setFull(false)} label={t('Your submission')}>
          <OverlayPanel title={t('Your submission')} onClose={() => setFull(false)} bodyClassName="px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-4 text-sm">
              <p className="text-neutral-500 dark:text-neutral-400">
                {t('Submitted {date}', { date: formatDue(sub.submitted_at) })}
                {sub.late ? ` ${t('(late)')}` : ''}
                {sub.attempt ? ` · ${t('attempt {n}', { n: sub.attempt })}` : ''}
              </p>
              <SubmittedWork sub={sub} />
            </div>
          </OverlayPanel>
        </Overlay>
      )}
    </div>
  );
}

/** What was handed in: the URL, the files (as cards) and the text. */
function SubmittedWork({ sub }: { sub: Submission }) {
  return (
    <>
      {sub.url && (
        <a href={sub.url} target="_blank" rel="noreferrer" className="block break-all text-accent-600 underline dark:text-accent-400">
          {sub.url}
        </a>
      )}
      {sub.attachments?.length ? <Attachments list={sub.attachments} /> : null}
      {sub.body && <HtmlContent html={sub.body} />}
    </>
  );
}

/** The marker for feedback not opened before this visit. */
export function NewPill({ children, small }: { children: string; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-accent-50 font-medium text-accent-700 dark:bg-accent-950 dark:text-accent-300 ${
        small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-sm'
      }`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-600 dark:bg-accent-400" />
      {children}
    </span>
  );
}

const pts = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The score inside a ring filled to the share of the points earned, with "Out of N pts" beside it. */
function ScoreRing({ score, points, grade }: { score: number; points: number | null; grade?: string | null }) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const share = points && points > 0 ? Math.min(1, Math.max(0, score / points)) : 0;
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r={r} fill="none" strokeWidth="5" className="stroke-neutral-200 dark:stroke-neutral-800" />
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${share * circumference} ${circumference}`}
            className="stroke-accent-600 dark:stroke-accent-400"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums">{score}</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{t('Points')}</span>
        </div>
      </div>
      <div className="text-neutral-500 dark:text-neutral-400">
        <p>{points != null ? t('Out of {n} pts', { n: points }) : null}</p>
        {grade && grade !== String(score) && <p className="mt-1 font-medium text-neutral-800 dark:text-neutral-100">{grade}</p>}
      </div>
    </div>
  );
}

/**
 * The class's low, mean, median and high for this assignment, like the Canvas app's grade card: a track from 0 to the
 * points possible with ticks at both ends and at the low and high, a heavier band between them, a line each at the mean
 * (amber) and the median, and a dot for your score. Canvas leaves the statistics out when the instructor hides them.
 */
function ClassStats({ stats, score, points }: { stats: ScoreStatistics; score: number; points: number | null }) {
  // The track runs from 0 to the points possible (or further, if someone scored above it).
  const top = Math.max(points ?? 0, stats.max, score);
  const at = (n: number) => `${top > 0 ? Math.min(100, Math.max(0, (n / top) * 100)) : 0}%`;
  const tick = (n: number) => (
    <div className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-400 dark:bg-neutral-500" style={{ left: at(n) }} />
  );
  return (
    <div className="rounded-md bg-neutral-50 px-4 pb-3 pt-5 dark:bg-black">
      <div
        className="relative mx-1 h-4"
        role="img"
        aria-label={t('Your score {score}; class low {low}, mean {mean}, median {median}, high {high}', { score: pts(score), low: pts(stats.min), mean: pts(stats.mean), median: pts(stats.median), high: pts(stats.max) })}
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-neutral-300 dark:bg-neutral-600" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-neutral-400 dark:bg-neutral-500" style={{ left: at(stats.min), right: `calc(100% - ${at(stats.max)})` }} />
        {tick(0)}
        {tick(stats.min)}
        {tick(stats.max)}
        {tick(top)}
        <div className="absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 bg-neutral-900 dark:bg-white" style={{ left: at(stats.median) }} />
        <div className="absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 bg-amber-500 dark:bg-amber-400" style={{ left: at(stats.mean) }} />
        <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-600 ring-2 ring-neutral-50 dark:bg-neutral-400 dark:ring-black" style={{ left: at(score) }} />
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
        <span>{t('Low: {n}', { n: pts(stats.min) })}</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1 bg-amber-500 dark:bg-amber-400" aria-hidden="true" />
          {t('Mean: {n}', { n: pts(stats.mean) })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1 bg-neutral-900 dark:bg-white" aria-hidden="true" />
          {t('Median: {n}', { n: pts(stats.median) })}
        </span>
        <span>{t('High: {n}', { n: pts(stats.max) })}</span>
      </div>
    </div>
  );
}

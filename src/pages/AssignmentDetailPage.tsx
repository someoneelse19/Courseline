import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Assignment, RubricCriterion, Submission } from '../api/types';
import { assignmentStatus } from '../components/AssignmentList';
import { HtmlContent } from '../components/HtmlContent';
import { SubmissionForm } from '../components/SubmissionForm';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useApi, useAuth } from '../context/AuthContext';
import { useFileViewer } from '../context/FileViewerContext';
import { useAssignment, useMySubmission } from '../hooks/useCanvasData';
import { formatDue } from '../lib/format';
import { htmlText, linkedFiles } from '../lib/html';

// Header + course tabs come from CourseLayout. Layout: instructions on the left;
// details, submission form, your submission and feedback (with reply) on the right.
// Types the form doesn't handle (URL, media, quizzes...) go through the "Submit in Canvas" button.
// TODO: peer reviews, quiz assignments (submission_types includes 'online_quiz'), discussion-type assignments.

const typeLabels: Record<string, string> = {
  online_upload: 'File upload',
  online_text_entry: 'Text entry',
  online_url: 'Website URL',
  online_quiz: 'Quiz',
  discussion_topic: 'Discussion',
  media_recording: 'Media recording',
  external_tool: 'External tool',
  on_paper: 'On paper',
  none: 'No submission',
};

export function AssignmentDetailPage() {
  const params = useParams();
  const courseId = Number(params.courseId);
  const assignmentId = Number(params.assignmentId);
  const { user } = useAuth();
  const { openFile } = useFileViewer();

  const assignment = useAssignment(courseId, assignmentId);
  const submission = useMySubmission(courseId, assignmentId);
  const description = assignment.data?.description ?? '';
  const attachedFiles = useMemo(() => linkedFiles(description), [description]);

  if (assignment.error) return <ErrorMessage error={assignment.error} onRetry={assignment.refetch} />;
  if (!assignment.data) return <Spinner />;
  const a = assignment.data;

  // Prefer the richer standalone submission; fall back to the one embedded in the assignment.
  const sub = submission.data ?? a.submission;
  const st = assignmentStatus({ ...a, submission: sub });
  const types = (a.submission_types ?? []).map((t) => typeLabels[t] ?? t);
  const comments = sub?.submission_comments ?? [];

  return (
    <>
      <Link to={`/courses/${courseId}/assignments`} className="text-sm text-accent-600 hover:underline dark:text-accent-400">
        ← All assignments
      </Link>
      <div className="mb-4 mt-1 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight">{a.name}</h2>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${st.className}`}>{st.label}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {a.locked_for_user && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">Locked</p>
              {a.lock_explanation && <HtmlContent html={a.lock_explanation} />}
            </div>
          )}

          <Card title="Instructions">
            {a.description ? <HtmlContent html={a.description} /> : <EmptyState>No instructions provided.</EmptyState>}
          </Card>

          {attachedFiles.length > 0 && (
            <Card title="Files">
              <ul className="space-y-2">
                {attachedFiles.map((file) => (
                  <li key={file.id} className="flex items-center gap-2">
                    <span>📄</span>
                    <button
                      type="button"
                      onClick={() => openFile(file.url, file.name)}
                      className="flex-1 text-left text-accent-600 hover:underline dark:text-accent-400"
                    >
                      {file.name}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {a.rubric && a.rubric.length > 0 && (
            <Card title="Rubric">
              <Rubric criteria={a.rubric} sub={sub} />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <Details a={a} types={types} />
            <a
              href={a.html_url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 block rounded-md bg-accent-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-accent-700"
            >
              {sub?.workflow_state === 'unsubmitted' || !sub ? 'Submit in Canvas ↗' : 'Open in Canvas ↗'}
            </a>
          </Card>

          <SubmissionForm
            courseId={courseId}
            assignmentId={assignmentId}
            assignment={a}
            onSubmitted={submission.refetch}
          />

          <Card title="Your submission">
            {submission.error && !a.submission ? (
              <ErrorMessage error={submission.error} onRetry={submission.refetch} />
            ) : !sub && submission.loading ? (
              <Spinner />
            ) : (
              <SubmissionView courseId={courseId} assignmentId={assignmentId} sub={sub} points={a.points_possible} />
            )}
          </Card>

          <Card title="Feedback">
            {comments.length === 0 ? (
              <EmptyState>No messages yet.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {comments.map((c) => (
                  <li key={c.id} className="text-sm">
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {c.author_id === user?.id ? 'You' : c.author_name} · {formatDue(c.created_at)}
                    </p>
                    {/* Comments are plain text: whitespace-pre-wrap keeps line breaks, React escapes the rest. */}
                    <p className="whitespace-pre-wrap">{c.comment}</p>
                    {c.attachments?.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => openFile(f.url, f.display_name)}
                        className="block text-left text-accent-600 underline hover:opacity-75 dark:text-accent-400"
                      >
                        📎 {f.display_name}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
            <ReplyBox courseId={courseId} assignmentId={assignmentId} onSent={submission.refetch} />
          </Card>
        </div>
      </div>
    </>
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
        placeholder="Write a reply…"
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
      {error && <ErrorMessage error={error} />}
      <button
        disabled={sending || !text.trim()}
        className="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Reply'}
      </button>
    </form>
  );
}

function Details({ a, types }: { a: Assignment; types: string[] }) {
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
  return (
    <dl className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {row('Due', formatDue(a.due_at))}
      {row('Points', a.points_possible != null ? String(a.points_possible) : '—')}
      {types.length > 0 && row('Submit via', types.join(', '))}
      {a.allowed_extensions && a.allowed_extensions.length > 0 && row('File types', a.allowed_extensions.join(', '))}
      {a.unlock_at && row('Available from', formatDue(a.unlock_at))}
      {a.lock_at && row('Closes', formatDue(a.lock_at))}
    </dl>
  );
}

function SubmissionView({
  courseId,
  assignmentId,
  sub,
  points,
}: {
  courseId: number;
  assignmentId: number;
  sub: Submission | undefined;
  points: number | null;
}) {
  const { openFile } = useFileViewer();
  const body = sub?.body ?? '';
  const bodyText = useMemo(() => (body ? htmlText(body) : ''), [body]);
  if (!sub || sub.workflow_state === 'unsubmitted') {
    return <EmptyState>{sub?.missing ? 'Marked missing.' : 'Nothing submitted yet.'}</EmptyState>;
  }

  const graded = sub.score != null;
  const isTruncated = bodyText.length > 300 || (sub.attachments?.length ?? 0) > 2;
  const truncatedBody = bodyText.slice(0, 300) + (bodyText.length > 300 ? '…' : '');

  return (
    <div className="space-y-3 text-sm">
      {graded && (
        <p className="text-2xl font-bold">
          {sub.score}
          <span className="text-base font-normal text-neutral-500 dark:text-neutral-400"> / {points ?? '?'}</span>
          {sub.grade && sub.grade !== String(sub.score) && <span className="ml-2 text-base font-medium">({sub.grade})</span>}
        </p>
      )}
      <p className="text-neutral-500 dark:text-neutral-400">
        Submitted {formatDue(sub.submitted_at)}
        {sub.late ? ' (late)' : ''}
        {sub.attempt ? ` · attempt ${sub.attempt}` : ''}
      </p>
      {sub.url && !isTruncated && (
        <a href={sub.url} target="_blank" rel="noreferrer" className="block break-all text-accent-600 underline dark:text-accent-400">
          {sub.url}
        </a>
      )}
      {!isTruncated &&
        sub.attachments?.map((f) => (
          <button
            key={f.id}
            onClick={() => openFile(f.url, f.display_name)}
            className="block text-left text-accent-600 underline dark:text-accent-400 hover:opacity-75"
          >
            📎 {f.display_name}
          </button>
        ))}
      {sub.body && !isTruncated && <HtmlContent html={sub.body} />}
      {isTruncated && (
        <>
          {truncatedBody && <p className="text-neutral-700 dark:text-neutral-300">{truncatedBody}</p>}
          {sub.attachments?.length ? <p className="text-neutral-600 dark:text-neutral-400">+ {sub.attachments.length} attachment(s)</p> : null}
          <Link
            to={`/courses/${courseId}/assignments/${assignmentId}/submission`}
            className="text-accent-600 hover:underline dark:text-accent-400"
          >
            ...view full submission
          </Link>
        </>
      )}
    </div>
  );
}

function Rubric({ criteria, sub }: { criteria: RubricCriterion[]; sub: Submission | undefined }) {
  return (
    <ul className="space-y-4">
      {criteria.map((c) => {
        const result = sub?.rubric_assessment?.[c.id];
        return (
          <li key={c.id} className="text-sm">
            <div className="flex justify-between gap-3">
              <p className="font-medium">{c.description}</p>
              <p className="shrink-0 font-medium">
                {result?.points != null ? `${result.points} / ` : ''}
                {c.points} pts
              </p>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.ratings.map((r) => {
                const chosen = result?.rating_id === r.id;
                return (
                  <span
                    key={r.id}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      chosen
                        ? 'border-accent-500 bg-accent-50 font-medium text-accent-800 dark:bg-accent-950 dark:text-accent-200'
                        : 'border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {r.description} · {r.points}
                  </span>
                );
              })}
            </div>
            {result?.comments && <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">“{result.comments}”</p>}
          </li>
        );
      })}
    </ul>
  );
}

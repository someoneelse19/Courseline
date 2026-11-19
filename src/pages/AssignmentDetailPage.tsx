import { Fragment, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Assignment, RubricCriterion, Submission } from '../api/types';
import { FeedbackCard, NewPill, SubmissionCard } from '../components/AssignmentFeedback';
import { assignmentStatus } from '../components/AssignmentList';
import { Attachments } from '../components/Attachments';
import { HtmlContent } from '../components/HtmlContent';
import { SubmissionForm } from '../components/SubmissionForm';
import { ToolCard } from '../components/ToolCard';
import { Card, EmptyState, ErrorMessage, Spinner, TabBlocked } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useAssignment, useMySubmission } from '../hooks/useCanvasData';
import { useOpenFeedback } from '../hooks/useReadState';
import { useCanvasTab } from '../hooks/useCanvasTab';
import { isQuiz, isToolAssignment } from '../lib/canvasTab';
import { markSeen } from '../lib/seen';
import { formatDue } from '../lib/format';
import { linkedFiles } from '../lib/html';
import { t } from '../i18n';

// Header + course tabs come from CourseLayout. Layout: title with status, the Canvas button and a line of facts (due,
// points, availability) on top; instructions, files and rubric on the left; on the right the submission form, your submission and feedback (with reply), ordered by whether
// anything is handed in yet (see sideCards).
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
  const { source } = useAuth();
  // Submitting and replying write to Canvas, which the extension cannot do: they need an access token.
  const readOnly = source === 'extension';

  const assignment = useAssignment(courseId, assignmentId);
  useEffect(() => {
    if (assignment.data) markSeen(courseId, 'assignments', [assignmentId]);
  }, [courseId, assignmentId, assignment.data]);
  const submission = useMySubmission(courseId, assignmentId);
  // Unread feedback: marked for this visit, then marked read (hooks/useReadState.ts).
  const { sub, newGrade, newCommentIds, hasNew: hasNewFeedback } = useOpenFeedback(courseId, assignmentId, submission, assignment.data?.submission);
  const description = assignment.data?.description ?? '';
  const attachedFiles = useMemo(() => linkedFiles(description), [description]);
  const canvasTab = useCanvasTab();

  if (assignment.error) return <ErrorMessage error={assignment.error} onRetry={assignment.refetch} />;
  if (!assignment.data) return <Spinner />;
  const a = assignment.data;

  const st = assignmentStatus({ ...a, submission: sub });
  // Handed in (or graded): the same test as SubmissionView's "Nothing submitted yet."
  const submitted = !!sub && sub.workflow_state !== 'unsubmitted';

  // The form shows its own tabs (upload / text) and allowed file types, so the facts line skips those while it is shown.
  const formShown = !readOnly && (a.submission_types ?? []).some((ty) => ty === 'online_upload' || ty === 'online_text_entry');

  const submitCard = readOnly ? (
    <Card title={t('Submit your work')}>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        {t('Submitting and replying need a Canvas access token, which you are not using. Use the Canvas button at the top to do it in Canvas, or add a token in Settings → Connection.')}
      </p>
    </Card>
  ) : (
    <SubmissionForm courseId={courseId} assignmentId={assignmentId} assignment={a} onSubmitted={submission.refetch} resubmit={submitted} />
  );
  const submissionCard = <SubmissionCard assignment={a} submission={submission} sub={sub} newGrade={newGrade} />;
  const feedbackCard = (
    <FeedbackCard courseId={courseId} assignmentId={assignmentId} comments={sub?.submission_comments ?? []} newCommentIds={newCommentIds} readOnly={readOnly} onSent={submission.refetch} />
  );
  // Right column: once something is handed in, what you handed in and the feedback on it come first and the form moves
  // to the bottom as "Resubmit"; before that, the form leads.
  // Keyed by card, so a card keeps its state (a half-written reply) when the order flips.
  const sideCards = submitted
    ? { submission: submissionCard, feedback: feedbackCard, submit: submitCard }
    : { submit: submitCard, feedback: feedbackCard, submission: submissionCard };

  return (
    <>
      <Link to={`/courses/${courseId}/assignments`} className="text-sm text-accent-600 hover:underline dark:text-accent-400">
        {t('← All assignments')}
      </Link>
      <div className="mb-4 mt-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-bold tracking-tight">{a.name}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {hasNewFeedback && <NewPill>{t('New feedback')}</NewPill>}
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${st.className}`}>{st.label}</span>
            {/* A quiz or another tool opens in a new tab, without Canvas's menus (lib/canvasTab.ts). */}
            {isToolAssignment(a) ? (
              <button type="button" onClick={() => canvasTab.open(a.html_url)} className="shrink-0 rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700">
                {isQuiz(a) ? t('Open quiz') : t('Open activity')}
              </button>
            ) : (
              <a
                href={a.html_url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md bg-accent-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-700"
              >
                {submitted ? t('Open in Canvas ↗') : t('Submit in Canvas ↗')}
              </a>
            )}
          </div>
        </div>
        <Facts a={a} formShown={formShown} />
        {canvasTab.blocked && <div className="mt-2"><TabBlocked /></div>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {a.locked_for_user && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-medium">{t('Locked')}</p>
              {a.lock_explanation && <HtmlContent html={a.lock_explanation} />}
            </div>
          )}

          {isToolAssignment(a) && (
            <Card title={isQuiz(a) ? t('Quiz') : t('Activity')}>
              <ToolCard url={a.html_url} name={a.name} icon={isQuiz(a) ? 'quiz' : 'externalTool'} />
            </Card>
          )}

          <Card title={t('Instructions')}>
            {a.description ? (
              <HtmlContent html={a.description} />
            ) : a.description_removed ? (
              <EmptyState>{t('These instructions contain a link that works without signing in, so Courseline does not keep them. Open this assignment in Canvas to read them.')}</EmptyState>
            ) : a.instructions_unknown ? (
              <EmptyState>{t('Instructions have not been synced yet. Press Sync now, or open this assignment in Canvas.')}</EmptyState>
            ) : (
              <EmptyState>{t('No instructions provided.')}</EmptyState>
            )}
          </Card>

          {attachedFiles.length > 0 && (
            <Card title={t('Files')}>
              {/* Plain Canvas file links (no signed address), so cards without thumbnails. */}
              <Attachments list={attachedFiles.map((f) => ({ id: f.id, display_name: f.name, url: f.url }))} thumbnails={false} />
            </Card>
          )}

          {a.rubric && a.rubric.length > 0 && (
            <Card title={t('Rubric')}>
              <Rubric criteria={a.rubric} sub={sub} />
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {Object.entries(sideCards).map(([key, card]) => (
            <Fragment key={key}>{card}</Fragment>
          ))}
        </div>
      </div>
    </>
  );
}

/** The assignment's facts as one wrapping line under the title: "Due … · 10 pts · Closes …". How to submit and which
 *  file types are allowed only appear when the submission form (which says both) is not on the page. */
function Facts({ a, formShown }: { a: Assignment; formShown: boolean }) {
  const facts: { label?: string; value: string }[] = [
    a.due_at ? { label: t('Due'), value: formatDue(a.due_at) } : { value: t('No due date') },
    { value: a.points_possible != null ? t('{n} pts', { n: a.points_possible }) : t('No points') },
  ];
  if (a.unlock_at) facts.push({ label: t('Available from'), value: formatDue(a.unlock_at) });
  if (a.lock_at) facts.push({ label: t('Closes'), value: formatDue(a.lock_at) });
  if (!formShown) {
    const types = (a.submission_types ?? []).map((ty) => t(typeLabels[ty] ?? ty));
    if (types.length > 0) facts.push({ label: t('Submit via'), value: types.join(', ') });
    if (a.allowed_extensions && a.allowed_extensions.length > 0) facts.push({ label: t('File types'), value: a.allowed_extensions.join(', ') });
  }
  return (
    <ul className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-neutral-600 dark:text-neutral-300">
      {facts.map((f, i) => (
        <li key={f.label ?? f.value} className="min-w-0 break-words">
          {i > 0 && <span aria-hidden="true" className="mr-1 text-neutral-400 dark:text-neutral-600">·</span>}
          {f.label && <span className="text-neutral-500 dark:text-neutral-400">{f.label} </span>}
          <span className="font-medium text-neutral-800 dark:text-neutral-100">{f.value}</span>
        </li>
      ))}
    </ul>
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
                {t('{n} pts', { n: c.points })}
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

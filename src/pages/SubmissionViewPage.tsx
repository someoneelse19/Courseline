import { Link, useParams } from 'react-router-dom';
import { HtmlContent } from '../components/HtmlContent';
import { Card, EmptyState, Spinner } from '../components/ui';
import { useFileViewer } from '../context/FileViewerContext';
import { useMySubmission } from '../hooks/useCanvasData';
import { formatDue } from '../lib/format';

export function SubmissionViewPage() {
  const params = useParams();
  const courseId = Number(params.courseId);
  const assignmentId = Number(params.assignmentId);
  const submission = useMySubmission(courseId, assignmentId);
  const { openFile } = useFileViewer();

  if (!submission.data) return <Spinner />;

  const sub = submission.data;
  if (!sub || sub.workflow_state === 'unsubmitted')
    return <EmptyState>Nothing submitted yet.</EmptyState>;

  return (
    <>
      <Link to={`/courses/${courseId}/assignments/${assignmentId}`} className="text-sm text-accent-600 hover:underline dark:text-accent-400">
        ← Back to assignment
      </Link>

      <h2 className="mt-4 mb-6 text-2xl font-bold">Your submission</h2>

      <div className="space-y-6">
        {sub.score != null && (
          <Card title="Score">
            <p className="text-3xl font-bold">
              {sub.score}
              <span className="text-base font-normal text-neutral-500 dark:text-neutral-400"> / {sub.score ?? '?'}</span>
              {sub.grade && sub.grade !== String(sub.score) && <span className="ml-2 text-lg font-medium">({sub.grade})</span>}
            </p>
          </Card>
        )}

        <Card title="Submitted">
          <p className="text-neutral-600 dark:text-neutral-400">
            {formatDue(sub.submitted_at)}
            {sub.late ? ' (late)' : ''}
            {sub.attempt ? ` · attempt ${sub.attempt}` : ''}
          </p>
        </Card>

        {sub.url && (
          <Card title="Submitted URL">
            <a href={sub.url} target="_blank" rel="noreferrer" className="block break-all text-accent-600 underline dark:text-accent-400">
              {sub.url}
            </a>
          </Card>
        )}

        {sub.attachments && sub.attachments.length > 0 && (
          <Card title="Attachments">
            <ul className="space-y-2">
              {sub.attachments.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => openFile(f.url, f.display_name)}
                    className="text-left text-accent-600 underline dark:text-accent-400 hover:opacity-75"
                  >
                    📎 {f.display_name}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {sub.body && (
          <Card title="Submission text">
            <HtmlContent html={sub.body} />
          </Card>
        )}
      </div>
    </>
  );
}

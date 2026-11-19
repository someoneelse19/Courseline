import { useParams } from 'react-router-dom';
import type { Assignment, CourseTab } from '../api/types';
import { assignmentStatus } from '../components/AssignmentList';
import { ToolCard } from '../components/ToolCard';
import { Card, EmptyState, ErrorMessage, Spinner } from '../components/ui';
import { useAssignments, useCourseTabs } from '../hooks/useCanvasData';
import { externalTools, isAttendanceTool, isQuiz } from '../lib/canvasTab';
import { formatDue } from '../lib/format';
import { t } from '../i18n';

// The "Tools" tab: the course's quizzes and the external tools in its Canvas menu (attendance and the like). Canvas will
// not let them be shown inside Courseline (lib/canvasTab.ts), so each opens in a new tab, without Canvas's
// menus.

function Quizzes({ list }: { list: Assignment[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((a) => {
        const st = assignmentStatus(a);
        return (
          <li key={a.id}>
            <ToolCard
              url={a.html_url}
              name={a.name}
              icon="quiz"
              detail={formatDue(a.due_at)}
              aside={<span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.className}`}>{st.label}</span>}
            />
          </li>
        );
      })}
    </ul>
  );
}

function Tools({ list }: { list: CourseTab[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {list.map((tab) => (
        <li key={tab.id}>
          <ToolCard url={tab.html_url} name={tab.label} icon={isAttendanceTool(tab.label) ? 'attendance' : 'externalTool'} />
        </li>
      ))}
    </ul>
  );
}

export function CourseToolsPage() {
  const courseId = Number(useParams().courseId);
  const tabs = useCourseTabs(courseId);
  const assignments = useAssignments(courseId);
  const quizzes = (assignments.data ?? []).filter(isQuiz);
  const tools = externalTools(tabs.data ?? []);

  return (
    <div className="space-y-6">
      {(quizzes.length > 0 || !assignments.data) && !assignments.error && (
        <Card title={t('Quizzes')}>{assignments.data ? <Quizzes list={quizzes} /> : <Spinner />}</Card>
      )}
      <Card title={t('Tools')}>
        <p className="-mt-1 mb-3 text-sm text-neutral-500 dark:text-neutral-400">{t('Canvas does not let other sites show these inside them, so each opens in a new tab, without Canvas’s menus.')}</p>
        {tabs.error ? (
          <ErrorMessage error={tabs.error} onRetry={tabs.refetch} />
        ) : !tabs.data ? (
          <Spinner />
        ) : tools.length ? (
          <Tools list={tools} />
        ) : (
          <EmptyState>{t('This course has no tools in its Canvas menu.')}</EmptyState>
        )}
      </Card>
    </div>
  );
}

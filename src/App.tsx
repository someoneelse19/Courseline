import { lazy, useEffect, useRef, type ComponentType } from 'react';
import { t } from './i18n';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CourseLayout } from './components/CourseLayout';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { ExtensionPinnedSync } from './components/ExtensionPinnedSync';
import { API_ONLY } from './edition';
import { useAuth } from './context/AuthContext';
import { CourseFilterProvider } from './context/CourseFilterContext';
import { CourseStyleProvider } from './context/CourseStyleContext';
import { DataProvider, useQueryStore } from './context/DataContext';
import { FileViewerProvider } from './context/FileViewerContext';
import { CoursesPage } from './pages/CoursesPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';

// The screens you land on are bundled with the app; the rest load the first time they are opened.
// Navigation runs in a transition, so the current screen stays up while the next one loads.
function lazyPage<K extends string, M extends Record<K, ComponentType>>(load: () => Promise<M>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
const AssignmentDetailPage = lazyPage(() => import('./pages/AssignmentDetailPage'), 'AssignmentDetailPage');
const AssignmentsPage = lazyPage(() => import('./pages/AssignmentsPage'), 'AssignmentsPage');
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'), 'CalendarPage');
const MessagesPage = lazyPage(() => import('./pages/MessagesPage'), 'MessagesPage');
const CourseAnnouncementsPage = lazyPage(() => import('./pages/CourseAnnouncementsPage'), 'CourseAnnouncementsPage');
const CourseDetailPage = lazyPage(() => import('./pages/CourseDetailPage'), 'CourseDetailPage');
const CourseExportPage = lazyPage(() => import('./pages/CourseExportPage'), 'CourseExportPage');
const CourseFilesPage = lazyPage(() => import('./pages/CourseFilesPage'), 'CourseFilesPage');
const CourseGradesPage = lazyPage(() => import('./pages/CourseGradesPage'), 'CourseGradesPage');
const CoursePagesPage = lazyPage(() => import('./pages/CoursePagesPage'), 'CoursePagesPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const SubmissionViewPage = lazyPage(() => import('./pages/SubmissionViewPage'), 'SubmissionViewPage');

/** New data arrived (the extension captured something): reload what is on screen in place, without remounting. */
function RefreshOnNewData({ version }: { version: string }) {
  const store = useQueryStore();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    store.refreshAll();
  }, [store, version]);
  return null;
}

/** /conversations?context_id=course_1&user_id=5 (Canvas's compose link) -> /messages/new with the same query. */
function ComposeRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/messages${new URLSearchParams(search).has('user_id') ? '/new' : ''}${search}`} replace />;
}

export default function App() {
  const { status, dataVersion, source, baseUrl } = useAuth();

  if (status === 'unauthenticated') return <LoginPage />;
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('Signing in…')} />
      </div>
    );
  }

  return (
    // DataProvider lives inside the auth gate so logout wipes the cache, and is rebuilt when the way data arrives
    // changes (extension <-> token, or another Canvas). New captured data does NOT rebuild it: RefreshOnNewData
    // reloads what is on screen in place, so forms and scroll positions survive.
    <DataProvider key={`${source}:${baseUrl}`}>
      <RefreshOnNewData version={dataVersion} />
      <CourseFilterProvider>
      <CourseStyleProvider>
      <FileViewerProvider>
      {!API_ONLY && <ExtensionPinnedSync />}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:courseId" element={<CourseLayout />}>
            {/* Pages is the default tab; /pages is the old URL for it. */}
            <Route index element={<CoursePagesPage />} />
            <Route path="pages" element={<Navigate to=".." relative="path" replace />} />
            <Route path="assignments" element={<CourseDetailPage />} />
            <Route path="announcements" element={<CourseAnnouncementsPage />} />
            <Route path="files" element={<CourseFilesPage />} />
            <Route path="export" element={<CourseExportPage />} />
            <Route path="grades" element={<CourseGradesPage />} />
            <Route path="assignments/:assignmentId" element={<AssignmentDetailPage />} />
            <Route path="assignments/:assignmentId/submission" element={<SubmissionViewPage />} />
          </Route>
          <Route path="assignments" element={<AssignmentsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/new" element={<MessagesPage />} />
          <Route path="messages/:conversationId" element={<MessagesPage />} />
          {/* Canvas's own Inbox address (its "message the teacher" links): the same screen, compose filled in. */}
          <Route path="conversations" element={<ComposeRedirect />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <p>
                {t('Page not found.')} <Link to="/" className="text-accent-600 underline">{t('Go home')}</Link>
              </p>
            }
          />
        </Route>
      </Routes>
      </FileViewerProvider>
      </CourseStyleProvider>
      </CourseFilterProvider>
    </DataProvider>
  );
}

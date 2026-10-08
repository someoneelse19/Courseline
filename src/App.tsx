import { lazy, type ComponentType } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { CourseLayout } from './components/CourseLayout';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import { CourseFilterProvider } from './context/CourseFilterContext';
import { DataProvider } from './context/DataContext';
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
const CourseDetailPage = lazyPage(() => import('./pages/CourseDetailPage'), 'CourseDetailPage');
const CourseFilesPage = lazyPage(() => import('./pages/CourseFilesPage'), 'CourseFilesPage');
const CourseGradesPage = lazyPage(() => import('./pages/CourseGradesPage'), 'CourseGradesPage');
const CoursePagesPage = lazyPage(() => import('./pages/CoursePagesPage'), 'CoursePagesPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const SubmissionViewPage = lazyPage(() => import('./pages/SubmissionViewPage'), 'SubmissionViewPage');

export default function App() {
  const { status } = useAuth();

  if (status === 'unauthenticated') return <LoginPage />;
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Signing in…" />
      </div>
    );
  }

  return (
    // DataProvider lives inside the auth gate so logout wipes the cache.
    <DataProvider>
      <CourseFilterProvider>
      <FileViewerProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="courses" element={<CoursesPage />} />
          <Route path="courses/:courseId" element={<CourseLayout />}>
            {/* Pages is the default tab; /pages is the old URL for it. */}
            <Route index element={<CoursePagesPage />} />
            <Route path="pages" element={<Navigate to=".." relative="path" replace />} />
            <Route path="assignments" element={<CourseDetailPage />} />
            <Route path="files" element={<CourseFilesPage />} />
            <Route path="grades" element={<CourseGradesPage />} />
            <Route path="assignments/:assignmentId" element={<AssignmentDetailPage />} />
            <Route path="assignments/:assignmentId/submission" element={<SubmissionViewPage />} />
          </Route>
          <Route path="assignments" element={<AssignmentsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <p>
                Page not found. <Link to="/" className="text-accent-600 underline">Go home</Link>
              </p>
            }
          />
        </Route>
      </Routes>
      </FileViewerProvider>
      </CourseFilterProvider>
    </DataProvider>
  );
}

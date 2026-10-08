import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { CourseLayout } from './components/CourseLayout';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useAuth } from './context/AuthContext';
import { CourseFilterProvider } from './context/CourseFilterContext';
import { DataProvider } from './context/DataContext';
import { FileViewerProvider } from './context/FileViewerContext';
import { AssignmentDetailPage } from './pages/AssignmentDetailPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { CourseDetailPage } from './pages/CourseDetailPage';
import { CourseFilesPage } from './pages/CourseFilesPage';
import { CourseGradesPage } from './pages/CourseGradesPage';
import { CoursePagesPage } from './pages/CoursePagesPage';
import { CoursesPage } from './pages/CoursesPage';
import { DashboardPage } from './pages/DashboardPage';
import { GradesPage } from './pages/GradesPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { SubmissionViewPage } from './pages/SubmissionViewPage';

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
          <Route path="grades" element={<GradesPage />} />
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

import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Spinner } from './ui';

/**
 * App shell: header on top, sidebar (dashboard / courses / settings) on the left,
 * routed page on the right. THIS is the only place page padding lives — pages must
 * not add their own outer padding, so spacing is identical everywhere.
 */
export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile drawer after navigating.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="flex h-screen flex-col">
      <Header onMenu={() => setMenuOpen((o) => !o)} />
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          {/* key=pathname resets the boundary when navigating away from a crashed page */}
          <ErrorBoundary key={pathname}>
            {/* Most screens load on first visit (App.tsx). */}
            <Suspense fallback={<Spinner />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { CanvasApiError } from '../api/client';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-neutral-500 dark:text-neutral-400" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorMessage({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const hint =
    error instanceof CanvasApiError && error.kind === 'rate_limit'
      ? 'Canvas throttles heavy usage — give it a few seconds.'
      : null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1">{error.message}</p>
      {hint && <p className="mt-1 opacity-80">{hint}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-white hover:bg-red-700">
          Try again
        </button>
      )}
    </div>
  );
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs dark:border-neutral-800 dark:bg-neutral-900">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-neutral-500 dark:text-neutral-400">{children}</p>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-4 text-2xl font-bold tracking-tight">{children}</h1>;
}

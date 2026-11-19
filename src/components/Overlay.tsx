import { useEffect, type ReactNode } from 'react';
import { t } from '../i18n';

// The app's one overlay: a dimmed backdrop with a panel over the page. The file viewer, the full submission and the
// text-entry editor all open in it, so they look and close the same way (Escape, the ✕ button, a click on the backdrop).

/** The backdrop: locks the page's scroll and closes on Escape or a click outside the panel. */
export function Overlay({ onClose, children, label }: { onClose: () => void; children: ReactNode; label?: string }) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-6xl">{children}</div>
    </div>
  );
}

export const overlayButton =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800';

/**
 * The panel: a header bar (title, actions, Close) over a body that fills the rest. `tall` panels fill most of the
 * screen; `footer` sits under the body (the editor's word count and Submit).
 */
export function OverlayPanel({
  title,
  onClose,
  toolbar,
  tall,
  footer,
  bodyClassName = 'p-3',
  children,
}: {
  title: string;
  onClose: () => void;
  toolbar?: ReactNode;
  tall?: boolean;
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900 ${
        tall ? 'h-[90vh]' : 'max-h-[90vh]'
      }`}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <h2 className="min-w-32 flex-1 truncate text-sm font-semibold" title={title}>
          {title}
        </h2>
        {toolbar}
        <button type="button" onClick={onClose} aria-label={t('Close')} className={overlayButton}>
          ✕ {t('Close')}
        </button>
      </header>
      <div className={`min-h-0 ${bodyClassName} ${tall ? 'flex-1' : 'overflow-auto'}`}>{children}</div>
      {footer && <footer className="shrink-0 border-t border-neutral-200 px-4 py-2 dark:border-neutral-800">{footer}</footer>}
    </div>
  );
}

import { lazy, Suspense, useEffect } from 'react';
import { Spinner } from './ui';

// The viewer (and the document libraries it loads) is only fetched the first time a file is opened.
const FileViewer = lazy(() => import('./FileViewer').then((m) => ({ default: m.FileViewer })));

interface FileViewerModalProps {
  isOpen: boolean;
  fileUrl: string;
  fileName: string;
  contentType?: string;
  onClose: () => void;
}

export function FileViewerModal({ isOpen, fileUrl, fileName, contentType, onClose }: FileViewerModalProps) {
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-6xl">
        <Suspense
          fallback={
            <div className="rounded-lg border border-neutral-200 bg-white px-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
              <Spinner label="Opening viewer…" />
            </div>
          }
        >
          <FileViewer fileUrl={fileUrl} fileName={fileName} contentType={contentType} onClose={onClose} />
        </Suspense>
      </div>
    </div>
  );
}

import { lazy, Suspense } from 'react';
import { Overlay } from './Overlay';
import { Spinner } from './ui';
import { t } from '../i18n';

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
  if (!isOpen) return null;

  return (
    <Overlay onClose={onClose} label={fileName}>
      <Suspense
        fallback={
          <div className="rounded-lg border border-neutral-200 bg-white px-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <Spinner label={t('Opening viewer…')} />
          </div>
        }
      >
        <FileViewer fileUrl={fileUrl} fileName={fileName} contentType={contentType} onClose={onClose} />
      </Suspense>
    </Overlay>
  );
}

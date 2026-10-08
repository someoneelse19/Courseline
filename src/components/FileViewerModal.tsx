import { useEffect } from 'react';
import { FileViewer } from './FileViewer';

interface FileViewerModalProps {
  isOpen: boolean;
  fileUrl: string;
  fileName: string;
  contentType?: string;
  onClose: () => void;
}

export function FileViewerModal({ isOpen, fileUrl, fileName, contentType, onClose }: FileViewerModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'auto';
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-6xl">
        <FileViewer fileUrl={fileUrl} fileName={fileName} contentType={contentType} onClose={onClose} />
      </div>
    </div>
  );
}

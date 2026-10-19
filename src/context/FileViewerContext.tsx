import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { FileViewerModal } from '../components/FileViewerModal';
import { useAuth } from './AuthContext';

// One shared file viewer for the whole app. Every file link goes through openFile(), so
// nothing downloads unless the user presses the explicit "Download file" button in the viewer.

interface OpenFile {
  url: string;
  name: string;
  type?: string;
}

interface FileViewerValue {
  openFile: (url: string, name?: string, type?: string) => void;
}

const FileViewerContext = createContext<FileViewerValue | null>(null);

export function FileViewerProvider({ children }: { children: ReactNode }) {
  const { source, baseUrl } = useAuth();
  const [file, setFile] = useState<OpenFile | null>(null);
  const openFile = useCallback(
    (url: string, name = 'File', type?: string) => {
      // Reading a file's bytes needs an access token. With the extension there is none, so the file opens in Canvas
      // itself (the student is signed in there) instead of showing an error.
      if (source === 'extension') {
        try {
          const target = new URL(url, baseUrl ?? window.location.origin);
          if (target.protocol === 'https:' || target.protocol === 'http:') window.open(target.href, '_blank', 'noopener,noreferrer');
        } catch {
          /* not an address: nothing to open */
        }
        return;
      }
      setFile({ url, name, type });
    },
    [source, baseUrl],
  );
  const close = useCallback(() => setFile(null), []);
  const value = useMemo(() => ({ openFile }), [openFile]);

  return (
    <FileViewerContext.Provider value={value}>
      {children}
      <FileViewerModal isOpen={!!file} fileUrl={file?.url ?? ''} fileName={file?.name ?? ''} contentType={file?.type} onClose={close} />
    </FileViewerContext.Provider>
  );
}

export function useFileViewer(): FileViewerValue {
  const ctx = useContext(FileViewerContext);
  if (!ctx) throw new Error('useFileViewer must be used inside <FileViewerProvider>');
  return ctx;
}

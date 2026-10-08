import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { FileViewerModal } from '../components/FileViewerModal';

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
  const [file, setFile] = useState<OpenFile | null>(null);
  const openFile = useCallback((url: string, name = 'File', type?: string) => setFile({ url, name, type }), []);
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

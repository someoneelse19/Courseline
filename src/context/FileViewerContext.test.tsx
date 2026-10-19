import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileViewerProvider, useFileViewer } from './FileViewerContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let auth: { source: string; baseUrl: string | null } = { source: 'extension', baseUrl: 'https://school.test' };
vi.mock('./AuthContext', () => ({ useAuth: () => auth }));
// The real viewer pulls in the PDF and spreadsheet libraries; a stand-in is enough to see whether it was opened.
vi.mock('../components/FileViewerModal', () => ({ FileViewerModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <p>viewer open</p> : null) }));

let open: ReturnType<typeof useFileViewer>['openFile'];
function Grab() {
  open = useFileViewer().openFile;
  return null;
}

async function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<FileViewerProvider><Grab /></FileViewerProvider>));
  return { el, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('FileViewerProvider', () => {
  it('with the extension (no token) a file opens in Canvas in a new tab instead of the viewer', async () => {
    auth = { source: 'extension', baseUrl: 'https://school.test' };
    const win = vi.spyOn(window, 'open').mockReturnValue(null);
    const m = await mount();
    await act(async () => open('/courses/1/files/42', 'Syllabus.pdf'));
    expect(win).toHaveBeenCalledWith('https://school.test/courses/1/files/42', '_blank', 'noopener,noreferrer');
    expect(m.el.textContent).not.toContain('viewer open');
    await m.unmount();
  });

  it('never opens a non-web address', async () => {
    auth = { source: 'extension', baseUrl: 'https://school.test' };
    const win = vi.spyOn(window, 'open').mockReturnValue(null);
    const m = await mount();
    await act(async () => open('javascript:alert(1)', 'x'));
    expect(win).not.toHaveBeenCalled();
    await m.unmount();
  });

  it('with a token the viewer opens as before', async () => {
    auth = { source: 'token', baseUrl: 'https://school.test' };
    const win = vi.spyOn(window, 'open').mockReturnValue(null);
    const m = await mount();
    await act(async () => open('https://school.test/courses/1/files/42', 'a.pdf'));
    expect(win).not.toHaveBeenCalled();
    expect(m.el.textContent).toContain('viewer open');
    await m.unmount();
  });
});

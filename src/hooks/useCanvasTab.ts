import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { openCanvasTab } from '../lib/canvasTab';

/** Opens a Canvas page (a quiz, an external tool) in a new tab; `blocked` when the browser stopped the tab. */
export function useCanvasTab() {
  const { baseUrl } = useAuth();
  const [blocked, setBlocked] = useState(false);
  return {
    open: (url: string) => setBlocked(!openCanvasTab(url, baseUrl ?? undefined)),
    blocked,
  };
}

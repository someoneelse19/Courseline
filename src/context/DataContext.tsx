import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

// A tiny keyed cache for API data: { 'courses': {...}, 'assignments:123': {...} }.
// Pages never fetch directly — they call useQuery() (hooks/useQuery.ts), so
// navigating away and back shows cached data instantly instead of refetching.
// Upgrade path: swap this for Zustand or TanStack Query; useQuery's signature can stay.

const STALE_MS = 5 * 60 * 1000; // refetch on next mount if data is older than this

interface Entry {
  data?: unknown;
  loading: boolean;
  error?: Error;
  fetchedAt?: number;
}

interface DataValue {
  entries: Record<string, Entry>;
  load: (key: string, fetcher: () => Promise<unknown>, force?: boolean) => void;
}

const DataContext = createContext<DataValue | null>(null);

/** Mount only while logged in, so logging out discards all cached data. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const inflight = useRef(new Set<string>());

  const load = useCallback((key: string, fetcher: () => Promise<unknown>, force = false) => {
    if (inflight.current.has(key)) return; // de-dupe concurrent requests for one key
    const existing = entriesRef.current[key];
    const fresh = existing?.fetchedAt !== undefined && Date.now() - existing.fetchedAt < STALE_MS;
    if (!force && fresh) return;

    inflight.current.add(key);
    // Keep stale `data` visible while refetching; only `loading` flips.
    setEntries((prev) => ({ ...prev, [key]: { ...prev[key], loading: true, error: undefined } }));

    fetcher()
      .then((data) => {
        setEntries((prev) => ({ ...prev, [key]: { data, loading: false, fetchedAt: Date.now() } }));
      })
      .catch((error: Error) => {
        setEntries((prev) => ({ ...prev, [key]: { ...prev[key], loading: false, error } }));
      })
      .finally(() => inflight.current.delete(key));
  }, []);

  const value = useMemo(() => ({ entries, load }), [entries, load]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

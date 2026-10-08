import { useEffect, useRef } from 'react';
import { useData } from '../context/DataContext';

export interface QueryResult<T> {
  data: T | undefined;
  /** True on first load AND background refetches; check `data` to tell them apart. */
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

/** Fetch-and-cache. `key` identifies the data; include every input to the fetcher in it. */
export function useQuery<T>(key: string, fetcher: () => Promise<T>): QueryResult<T> {
  const { entries, load } = useData();
  // Always call the latest fetcher without making it an effect dependency.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    load(key, () => fetcherRef.current());
  }, [key, load]);

  const entry = entries[key];
  return {
    data: entry?.data as T | undefined,
    loading: entry ? entry.loading : true, // no entry yet = about to load
    error: entry?.error,
    refetch: () => load(key, () => fetcherRef.current(), true),
  };
}

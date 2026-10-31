import { createContext, useContext, useState, type ReactNode } from 'react';

// A tiny keyed cache for API data: { 'courses': {...}, 'assignments:123': {...} }.
// Pages never fetch directly — they call useQuery() (hooks/useQuery.ts), so
// navigating away and back shows cached data instantly instead of refetching.
// Components subscribe to their own key only, so a response re-renders just the components that read it.
// Upgrade path: swap this for Zustand or TanStack Query; useQuery's signature can stay.

const STALE_MS = 5 * 60 * 1000; // refetch on next mount if data is older than this

export interface Entry {
  data?: unknown;
  loading: boolean;
  error?: Error;
  fetchedAt?: number;
}

export class QueryStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private inflight = new Map<string, Promise<unknown>>();
  private fetchers = new Map<string, () => Promise<unknown>>(); // the latest fetcher per key, for refreshAll
  private dirty = new Set<string>(); // keys that were told to refresh while a request was already running

  get(key: string): Entry | undefined {
    return this.entries.get(key);
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }

  /** Fetch `key` unless its data is fresh or a request for it is already running. Failures land in `error`. */
  load(key: string, fetcher: () => Promise<unknown>, force = false): void {
    this.request(key, fetcher, force).catch(() => {});
  }

  /** The data for `key` as a promise: the cached copy if fresh, else the running or a new request. Rejects on failure. */
  ensure<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    return this.request(key, fetcher, false) as Promise<T>;
  }

  /** Store data that arrived inside another response (a list that carries full items), unless fresher data is there. */
  prime(key: string, data: unknown): void {
    if (!this.isFresh(key) && !this.inflight.has(key)) this.set(key, { data, loading: false, fetchedAt: Date.now() });
  }

  private isFresh(key: string): boolean {
    const fetchedAt = this.entries.get(key)?.fetchedAt;
    return fetchedAt !== undefined && Date.now() - fetchedAt < STALE_MS;
  }

  private set(key: string, entry: Entry) {
    this.entries.set(key, entry);
    this.listeners.get(key)?.forEach((notify) => notify());
  }

  /**
   * The data behind every query has changed (the extension captured something new): reload what is on screen in
   * place, and make everything else stale so it reloads the next time it is shown. Nothing is thrown away, so
   * screens keep their state and their old data stays visible until the new data arrives.
   */
  refreshAll(): void {
    const keys = [...this.entries.keys()];
    // Everything is stale before anything reloads, so a reload that reads other keys (through ensure) never gets
    // their old copies back.
    for (const key of keys) this.entries.set(key, { ...this.entries.get(key)!, fetchedAt: 0 });
    for (const key of keys) {
      const fetcher = this.fetchers.get(key);
      if (!this.listeners.has(key) || !fetcher) continue;
      if (this.inflight.has(key)) this.dirty.add(key); // the running request may hold old data: go again after it
      else this.load(key, fetcher, true);
    }
  }

  private request(key: string, fetcher: () => Promise<unknown>, force: boolean): Promise<unknown> {
    this.fetchers.set(key, fetcher);
    const running = this.inflight.get(key); // de-dupe concurrent requests for one key
    if (running) return running;
    if (!force && this.isFresh(key)) return Promise.resolve(this.entries.get(key)!.data);

    // Keep stale `data` visible while refetching; only `loading` flips.
    this.set(key, { ...this.entries.get(key), loading: true, error: undefined });
    const request = fetcher()
      .then(
        (data) => {
          this.set(key, { data, loading: false, fetchedAt: Date.now() });
          return data;
        },
        (error: Error) => {
          this.set(key, { ...this.entries.get(key), loading: false, error });
          throw error;
        },
      )
      .finally(() => {
        this.inflight.delete(key);
        if (this.dirty.delete(key)) this.load(key, this.fetchers.get(key)!, true);
      });
    this.inflight.set(key, request);
    return request;
  }
}

const DataContext = createContext<QueryStore | null>(null);

/** Mount only while logged in, so logging out discards all cached data. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new QueryStore());
  return <DataContext.Provider value={store}>{children}</DataContext.Provider>;
}

export function useQueryStore(): QueryStore {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useQueryStore must be used inside <DataProvider>');
  return ctx;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { extensionInstalled, loadSnapshot, onExtensionChange, setCanvasAddress, type AddressResult, type Snapshot } from './bridge';

export interface ExtensionSetup {
  /** The extension's bridge has announced itself on this page. */
  installed: boolean;
  /** The first answer from the extension has arrived (always true when it is not installed). */
  loaded: boolean;
  snapshot: Snapshot | null;
  /** The saved Canvas address (host), or null. */
  canvasHost: string | null;
  /** How many captured responses the extension holds. */
  recordCount: number;
  /** When something was last captured (ms), or null. */
  lastCapturedAt: number | null;
  saveAddress: (input: string) => Promise<AddressResult | null>;
  reload: () => Promise<void>;
}

/** What the setup screens need to know about the extension, kept live as it captures. */
export function useExtensionSetup(): ExtensionSetup {
  const installed = extensionInstalled();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(!installed);

  const latest = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const next = await loadSnapshot();
    if (mine !== latest.current) return; // a newer request has gone out since: ignore this older answer
    setSnapshot(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!installed) return;
    void reload();
    // The extension reports a change about every 300 ms while a sync runs; reloading the whole store for each is wasteful.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onExtensionChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 1000);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [installed, reload]);

  const saveAddress = useCallback(
    async (input: string) => {
      const result = await setCanvasAddress(input);
      await reload();
      return result;
    },
    [reload],
  );

  const times = snapshot?.records.map((r) => r.capturedAt) ?? [];
  return {
    installed,
    loaded,
    snapshot,
    canvasHost: snapshot?.canvasHost ?? null,
    recordCount: snapshot?.records.length ?? 0,
    lastCapturedAt: times.length ? Math.max(...times) : null,
    saveAddress,
    reload,
  };
}

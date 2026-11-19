import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createCanvasApi, type CanvasApi } from '../api/canvas';
import { normalizeBaseUrl } from '../api/client';
import type { UserProfile } from '../api/types';
import { extensionInstalled, loadSnapshot, onExtensionChange, type Snapshot } from '../extension/bridge';
import { baseUrlOf, createExtensionApi, lastUpdatedAt } from '../extension/extensionApi';
import { forgetCookieKey, open, outdated, parseStored, seal, vaultAvailable, type Credentials, type SealedCredentials } from '../lib/tokenVault';

// ⚠️ SECURITY: the token is saved in localStorage encrypted (lib/tokenVault.ts: AES-GCM under a key in IndexedDB and a
// secret in a cookie, which Chrome encrypts with the OS key store), so a copy of the storage does not reveal it. A script running on this origin (an
// XSS bug or a malicious npm dependency) can still use it: it can ask the browser to decrypt, or read it in memory.
// A Canvas personal token acts as YOU, with full access, until it expires/is revoked.
// Fine for a local MVP. Before sharing/deploying: move to a backend that holds the
// token (or use Canvas OAuth2 with a server-side secret), and keep tokens short-lived.
const STORAGE_KEY = 'courseline.credentials';
const USE_PROXY = import.meta.env.VITE_USE_DEV_PROXY === 'true';
// Set when someone logs out of extension mode, so they get the token form instead of being signed straight back in.
const SKIP_EXTENSION_KEY = 'courseline.skip-extension';

function skipExtension(): boolean {
  try {
    return localStorage.getItem(SKIP_EXTENSION_KEY) === '1';
  } catch {
    return false;
  }
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthValue {
  status: AuthStatus;
  user: UserProfile | null;
  /** Non-null only when `status` is 'authenticated'. Prefer the useApi() hook. */
  api: CanvasApi | null;
  baseUrl: string | null;
  /** Non-null only when `status` is 'authenticated'. For file uploads and direct API calls. */
  token: string | null;
  error: string | null;
  /** 'token': data comes from Canvas's API. 'extension': from what the browser extension captured. */
  source: 'token' | 'extension';
  /** What the extension captured (extension mode only). */
  snapshot: Snapshot | null;
  /** Bumps whenever new captured data arrives, so cached screens can be rebuilt. */
  dataVersion: string;
  /** The extension is installed but the student chose a token last time. */
  extensionAvailable: boolean;
  enableExtension: () => void;
  login: (baseUrl: string, token: string) => void;
  logout: () => void;
}

/**
 * What is saved, read synchronously: plain credentials (from .env, or saved before the token was encrypted), or sealed
 * ones that still have to be opened (async). A plain saved token is sealed again on the first load.
 */
function readSaved(): { creds: Credentials | null; sealed: SealedCredentials | null; resave: boolean } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* unavailable storage — fall through to env */
  }
  const saved = parseStored(raw);
  if (saved && 'sealed' in saved) return { creds: null, sealed: saved.sealed, resave: false };
  if (saved) return { creds: saved.plain, sealed: null, resave: true };
  // Dev convenience: .env values skip the login screen (see .env.example warning).
  const { VITE_CANVAS_BASE_URL: baseUrl, VITE_CANVAS_API_TOKEN: token } = import.meta.env;
  return { creds: baseUrl && token ? { baseUrl, token } : null, sealed: null, resave: false };
}

function forgetSaved() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [saved] = useState(readSaved);
  const [creds, setCreds] = useState<Credentials | null>(saved.creds);
  // A sealed token is being opened: neither signed in nor out yet (and not extension mode either).
  const [unsealing, setUnsealing] = useState(saved.sealed !== null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [skip, setSkip] = useState(skipExtension);
  // No token saved and the extension is installed: sign in with its data. Checked once, synchronously.
  const wantsExtension = !creds && !unsealing && !skip && extensionInstalled();
  const [status, setStatus] = useState<AuthStatus>(creds || unsealing || wantsExtension ? 'loading' : 'unauthenticated');
  const [error, setError] = useState<string | null>(null);
  // Bumped by every sign-in and sign-out, so a save that finishes after the student moved on is dropped.
  const generation = useRef(0);

  /** Saves the token sealed, or not at all where there is nowhere to keep the key (then it lasts this visit). */
  const save = useCallback((next: Credentials) => {
    const gen = generation.current;
    if (!vaultAvailable()) return forgetSaved();
    seal(next)
      .then((sealed) => {
        if (generation.current !== gen) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sealed));
      })
      .catch(() => {
        if (generation.current === gen) forgetSaved(); // never leave a plain token behind
      });
  }, []);

  // Open the sealed token once, on start; a token saved before encryption is sealed now.
  useEffect(() => {
    if (saved.sealed) {
      let cancelled = false;
      const sealed = saved.sealed;
      void open(sealed).then((opened) => {
        if (cancelled) return;
        if (opened) {
          setCreds(opened);
          if (outdated(sealed)) save(opened);
        }
        else {
          forgetSaved(); // the key is gone (site data partly cleared) or the value was changed: sign in again
          setStatus('unauthenticated');
        }
        setUnsealing(false);
      });
      return () => {
        cancelled = true;
      };
    }
    if (saved.resave && saved.creds) save(saved.creds);
  }, [saved, save]);

  const logout = useCallback(() => {
    generation.current++;
    forgetSaved();
    forgetCookieKey();
    // Signing out of extension mode means "let me use a token": remember it so the form shows.
    if (extensionInstalled()) {
      try {
        localStorage.setItem(SKIP_EXTENSION_KEY, '1');
      } catch {
        /* ignore */
      }
      setSkip(true);
    }
    setCreds(null);
    setSnapshot(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  // Latest values for callbacks that must not re-create on every change.
  const credsRef = useRef(creds);
  credsRef.current = creds;
  const skipRef = useRef(skip);
  skipRef.current = skip;
  // Bumped to make the extension load run again even though nothing else about extension mode changed.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Switch to the extension: forget any saved token, stop skipping the extension, and load its data.
  const enableExtension = useCallback(() => {
    const wasAlreadyExtension = !credsRef.current && !skipRef.current;
    generation.current++;
    try {
      localStorage.removeItem(SKIP_EXTENSION_KEY);
    } catch {
      /* ignore */
    }
    forgetSaved();
    forgetCookieKey();
    setUnsealing(false);
    setError(null);
    setCreds(null);
    setUser(null);
    setSkip(false);
    // Already in extension mode (the login page): stay on it and just load again. Coming from a token, or from
    // having skipped the extension, there is nothing to show yet, so wait on the spinner for the load.
    if (!wasAlreadyExtension) setStatus('loading');
    setReloadNonce((n) => n + 1);
  }, []);

  // Extension mode: load what the extension captured, and again whenever it saves something new.
  const extensionActive = !creds && !unsealing && !skip && extensionInstalled();
  useEffect(() => {
    if (!extensionActive) return;
    let cancelled = false;
    const load = async () => {
      const next = await loadSnapshot();
      if (cancelled) return;
      if (next === null) {
        // The extension did not answer in time (busy, or just reloaded). That is not the same as "nothing captured":
        // a signed-in student stays signed in with what they have, and the next change tries again.
        setStatus((s) => (s === 'authenticated' ? s : 'unauthenticated'));
        return;
      }
      if (next.records.length > 0) {
        setSnapshot(next);
      } else {
        // Nothing captured yet: the login page explains what to do, and this keeps listening, so the first
        // capture signs the student in without a reload.
        setSnapshot(null);
        setStatus('unauthenticated');
      }
    };
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onExtensionChange(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 1500);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop();
    };
  }, [extensionActive, reloadNonce]);

  const api = useMemo(
    () =>
      creds
        ? createCanvasApi({
            ...creds,
            proxyPrefix: USE_PROXY ? '/canvas-proxy' : undefined,
            onUnauthorized: logout, // any 401 anywhere → back to login
          })
        : snapshot && extensionActive
          ? createExtensionApi(snapshot)
          : null,
    [creds, logout, snapshot, extensionActive],
  );

  // Validate credentials by fetching the profile whenever they change.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    // New captured data refreshes in place; only a first load or a new token shows the spinner.
    setStatus((s) => (s === 'authenticated' ? s : 'loading'));
    api
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        setUser(profile);
        setError(null);
        setStatus('authenticated');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const login = useCallback((baseUrl: string, token: string) => {
    const next = { baseUrl: normalizeBaseUrl(baseUrl), token: token.trim() };
    generation.current++;
    forgetSaved(); // whatever was saved before belongs to the old sign-in
    save(next); // sealed, in the background; storage unavailable: session-only login still works
    setUnsealing(false);
    setError(null);
    // A new way of getting data: forget what the old one gave (the cache is rebuilt, see DataProvider's key in App).
    setUser(null);
    setSnapshot(null);
    setCreds(next);
  }, [save]);

  const source = creds || !snapshot ? 'token' : 'extension';
  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      api,
      baseUrl: creds?.baseUrl ?? (snapshot && source === 'extension' ? baseUrlOf(snapshot) : null),
      token: creds?.token ?? null,
      error,
      source,
      snapshot: source === 'extension' ? snapshot : null,
      dataVersion: snapshot ? `${snapshot.records.length}:${lastUpdatedAt(snapshot) ?? 0}:${(snapshot.appPinned ?? []).join(',')}:${snapshot.canvasHost ?? ''}` : '',
      extensionAvailable: extensionInstalled() && skip,
      enableExtension,
      login,
      logout,
    }),
    [status, user, api, creds, snapshot, source, skip, error, enableExtension, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For components that only render when logged in. */
export function useApi(): CanvasApi {
  const { api } = useAuth();
  if (!api) throw new Error('useApi called while logged out');
  return api;
}

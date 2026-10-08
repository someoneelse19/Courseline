import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createCanvasApi, type CanvasApi } from '../api/canvas';
import { normalizeBaseUrl } from '../api/client';
import type { UserProfile } from '../api/types';

// ⚠️ SECURITY: the token is stored in localStorage, which any script running on
// this origin can read (an XSS bug or a malicious npm dependency = stolen token).
// A Canvas personal token acts as YOU, with full access, until it expires/is revoked.
// Fine for a local MVP. Before sharing/deploying: move to a backend that holds the
// token (or use Canvas OAuth2 with a server-side secret), and keep tokens short-lived.
const STORAGE_KEY = 'better-canvas.credentials';
const USE_PROXY = import.meta.env.VITE_USE_DEV_PROXY === 'true';

interface Credentials {
  baseUrl: string;
  token: string;
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
  login: (baseUrl: string, token: string) => void;
  logout: () => void;
}

function loadCredentials(): Credentials | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Credentials;
  } catch {
    /* corrupt or unavailable storage — fall through to env */
  }
  // Dev convenience: .env values skip the login screen (see .env.example warning).
  const { VITE_CANVAS_BASE_URL: baseUrl, VITE_CANVAS_API_TOKEN: token } = import.meta.env;
  return baseUrl && token ? { baseUrl, token } : null;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [creds, setCreds] = useState<Credentials | null>(loadCredentials);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<AuthStatus>(creds ? 'loading' : 'unauthenticated');
  const [error, setError] = useState<string | null>(null);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setCreds(null);
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const api = useMemo(
    () =>
      creds
        ? createCanvasApi({
            ...creds,
            proxyPrefix: USE_PROXY ? '/canvas-proxy' : undefined,
            onUnauthorized: logout, // any 401 anywhere → back to login
          })
        : null,
    [creds, logout],
  );

  // Validate credentials by fetching the profile whenever they change.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setStatus('loading');
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable: session-only login still works */
    }
    setError(null);
    setCreds(next);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, user, api, baseUrl: creds?.baseUrl ?? null, token: creds?.token ?? null, error, login, logout }),
    [status, user, api, creds, error, login, logout],
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

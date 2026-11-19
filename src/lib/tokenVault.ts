// Keeps the Canvas token encrypted at rest, under two keys, so that no single place the browser keeps holds enough to
// read it:
//   1. a key in IndexedDB, made once as a non-extractable CryptoKey: page code can use it but never read its bytes;
//   2. a random secret in a cookie (`courseline_vault`). Chrome encrypts cookies on disk with a key from the operating
//      system's key store (the macOS Keychain, Windows DPAPI), which IndexedDB and localStorage are not.
// The token is AES-GCM encrypted with the cookie key, then with the IndexedDB key, and the Canvas address is the
// additional data of both (so pointing the saved token at another host makes it fail to open). In localStorage there
// is only ciphertext.
//
// What this protects against: someone reading localStorage (DevTools, a storage dump, a copy of it), and a copy of
// the browser profile's files without the operating system's key store (a backup, another account): IndexedDB's files
// do hold the first key's bytes (checked Nov 19, 2026), but the cookie secret is encrypted there. Other sites on
// `localhost` (any port) can read the cookie, but not this origin's localStorage or IndexedDB. On Linux without a
// keyring, Chrome's cookie encryption is only nominal.
// What it does NOT protect against: a script running on this page (an XSS bug, a malicious dependency) can ask the
// browser to decrypt, or read the token from memory once signed in. See README § Security.
//
// Not a key derived from the browser (version, user agent): that changes on every browser update, which would sign the
// student out, and anyone can compute it, so it would only hide the token, not protect it.

export interface Credentials {
  baseUrl: string;
  token: string;
}

/**
 * What is saved in localStorage: the address in the clear (not secret), the token sealed. v2: under the cookie key, then
 * the IndexedDB key (`iv2` is the inner layer's). v1 (IndexedDB key only) was saved briefly before v2; it still opens
 * and is saved again as v2.
 */
export interface SealedCredentials {
  v: 1 | 2;
  baseUrl: string;
  iv: string; // base64, 12 bytes: the IndexedDB key's layer
  iv2?: string; // base64, 12 bytes: the cookie key's layer (v2)
  token: string; // base64 AES-GCM ciphertext (with its tag)
}

/** Where the key lives. IndexedDB in the browser; tests pass their own. */
export interface KeyStore {
  get(): Promise<CryptoKey | undefined>;
  put(key: CryptoKey): Promise<void>;
}

const DB = 'courseline-vault';
const STORE = 'keys';
const KEY_ID = 'token-key';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  return request(r);
}

const indexedDbStore: KeyStore = {
  async get() {
    const db = await openDb();
    try {
      return (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY_ID))) as CryptoKey | undefined;
    } finally {
      db.close();
    }
  },
  async put(key) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(key, KEY_ID);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};

function toB64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function fromB64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

let keyStore: KeyStore | null = typeof indexedDB !== 'undefined' ? indexedDbStore : null;
let keyPromise: Promise<CryptoKey> | null = null;

/** Tests: use another key store (null = none available). */
export function setKeyStore(store: KeyStore | null): void {
  keyStore = store;
  keyPromise = null;
}

/** Is there somewhere to keep the keys? Without one the token is not saved at all (signed in for this visit only). */
export function vaultAvailable(): boolean {
  return keyStore !== null && typeof crypto !== 'undefined' && !!crypto.subtle && typeof document !== 'undefined' && navigator.cookieEnabled !== false;
}

// --- The cookie secret --------------------------------------------------------------------------------------------

export const COOKIE = 'courseline_vault';
// Chrome keeps a cookie at most 400 days; it is set again on every sign-in from it, so it only lapses after 400 idle days.
const COOKIE_MAX_AGE = 400 * 24 * 3600;

function readCookie(): string | null {
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=') || null;
  }
  return null;
}

function writeCookie(value: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Strict${secure}`;
}

/** Forget the cookie secret (sign-out): what was sealed with it can no longer be opened. */
export function forgetCookieKey(): void {
  if (typeof document !== 'undefined') document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`;
}

const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

/** The cookie key: made on first use (32 random bytes), its expiry renewed each time it is used. */
async function cookieKey(create: boolean): Promise<CryptoKey> {
  let secret = readCookie();
  if (!secret) {
    if (!create) throw new Error('no cookie key');
    secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  }
  const raw = fromB64url(secret);
  if (raw.length !== 32) throw new Error('bad cookie key');
  writeCookie(secret);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** The key, made on first use. One per browser profile and origin. */
function getKey(create: boolean): Promise<CryptoKey> {
  if (!keyStore) return Promise.reject(new Error('no key store'));
  const store = keyStore;
  keyPromise ??= (async () => {
    const existing = await store.get();
    if (existing) return existing;
    if (!create) throw new Error('no key');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await store.put(key);
    return key;
  })();
  // A failure (storage blocked, no key yet) should not stick: the next call tries again.
  keyPromise.catch(() => {
    keyPromise = null;
  });
  return keyPromise;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const gcm = (iv: Uint8Array, baseUrl: string) => ({ name: 'AES-GCM', iv, additionalData: enc.encode(baseUrl) });

export async function seal(creds: Credentials): Promise<SealedCredentials> {
  const [outer, inner] = await Promise.all([getKey(true), cookieKey(true)]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iv2 = crypto.getRandomValues(new Uint8Array(12));
  const once = await crypto.subtle.encrypt(gcm(iv2, creds.baseUrl), inner, enc.encode(creds.token));
  const twice = await crypto.subtle.encrypt(gcm(iv, creds.baseUrl), outer, once);
  return { v: 2, baseUrl: creds.baseUrl, iv: toB64(iv), iv2: toB64(iv2), token: toB64(new Uint8Array(twice)) };
}

/** Saved in an older format: open it, then save it again with `seal`. */
export const outdated = (sealed: SealedCredentials) => sealed.v !== 2;

/**
 * The credentials back, or null when they cannot be opened: a key was cleared (site data, or just the cookies), or the
 * saved value was changed.
 */
export async function open(sealed: SealedCredentials): Promise<Credentials | null> {
  try {
    const outer = await getKey(false);
    let data = await crypto.subtle.decrypt(gcm(fromB64(sealed.iv), sealed.baseUrl), outer, fromB64(sealed.token));
    if (sealed.v === 2) {
      if (!sealed.iv2) return null;
      data = await crypto.subtle.decrypt(gcm(fromB64(sealed.iv2), sealed.baseUrl), await cookieKey(false), data);
    }
    return { baseUrl: sealed.baseUrl, token: dec.decode(data) };
  } catch {
    return null;
  }
}

/** What a saved value is: sealed, or a plain one from before encryption (opened once, then saved sealed). */
export function parseStored(raw: string | null): { sealed: SealedCredentials } | { plain: Credentials } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SealedCredentials & Credentials>;
    if (v && (v.v === 1 || v.v === 2) && typeof v.baseUrl === 'string' && typeof v.iv === 'string' && typeof v.token === 'string') return { sealed: v as SealedCredentials };
    if (v && typeof v.baseUrl === 'string' && typeof v.token === 'string') return { plain: { baseUrl: v.baseUrl, token: v.token } };
  } catch {
    /* corrupt */
  }
  return null;
}

import { afterEach, describe, expect, it } from 'vitest';
import { COOKIE, forgetCookieKey, open, outdated, parseStored, seal, setKeyStore, vaultAvailable, type KeyStore } from './tokenVault';

/** A key store kept in memory (the browser keeps it in IndexedDB). */
function memoryStore(): KeyStore & { key?: CryptoKey } {
  const store: KeyStore & { key?: CryptoKey } = {
    get: async () => store.key,
    put: async (k) => {
      store.key = k;
    },
  };
  return store;
}

afterEach(() => {
  setKeyStore(null);
  forgetCookieKey();
});

describe('tokenVault', () => {
  it('seals the token so it is not in what is saved, and opens it again', async () => {
    setKeyStore(memoryStore());
    const sealed = await seal({ baseUrl: 'https://school.test', token: '1234~secret-token' });
    const saved = JSON.stringify(sealed);
    expect(saved).not.toContain('secret-token');
    expect(sealed).toMatchObject({ v: 2, baseUrl: 'https://school.test' });
    expect(outdated(sealed)).toBe(false);
    expect(await open(sealed)).toEqual({ baseUrl: 'https://school.test', token: '1234~secret-token' });
  });

  it('makes a key the page cannot read out, once, and reuses it', async () => {
    const store = memoryStore();
    setKeyStore(store);
    const a = await seal({ baseUrl: 'https://school.test', token: 'A' });
    const key = store.key!;
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    await seal({ baseUrl: 'https://school.test', token: 'B' });
    expect(store.key).toBe(key);
    // Same token twice gives different ciphertext (a fresh IV each time).
    const again = await seal({ baseUrl: 'https://school.test', token: 'A' });
    expect(again.token).not.toBe(a.token);
  });

  it('will not open a token whose Canvas address was changed', async () => {
    setKeyStore(memoryStore());
    const sealed = await seal({ baseUrl: 'https://school.test', token: 'T' });
    expect(await open({ ...sealed, baseUrl: 'https://evil.test' })).toBeNull();
  });

  it('cannot open a token once its key is gone (site data cleared), and does not make a new key for it', async () => {
    setKeyStore(memoryStore());
    const sealed = await seal({ baseUrl: 'https://school.test', token: 'T' });
    const fresh = memoryStore();
    setKeyStore(fresh);
    expect(await open(sealed)).toBeNull();
    expect(fresh.key).toBeUndefined();
  });

  it('keeps the second key in a cookie, and cannot open without it (cookies cleared)', async () => {
    setKeyStore(memoryStore());
    const sealed = await seal({ baseUrl: 'https://school.test', token: 'T' });
    const secret = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`))!.slice(COOKIE.length + 1);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes
    expect(JSON.stringify(sealed)).not.toContain(secret);
    forgetCookieKey();
    expect(document.cookie).not.toContain(COOKIE);
    expect(await open(sealed)).toBeNull();
  });

  it('opens a value sealed with the IndexedDB key only (v1) and says it is outdated', async () => {
    const store = memoryStore();
    setKeyStore(store);
    await seal({ baseUrl: 'https://school.test', token: 'x' }); // makes the IndexedDB key
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('https://school.test') }, store.key!, new TextEncoder().encode('old'));
    const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
    const v1 = { v: 1 as const, baseUrl: 'https://school.test', iv: b64(iv), token: b64(new Uint8Array(data)) };
    expect(outdated(v1)).toBe(true);
    expect(await open(v1)).toEqual({ baseUrl: 'https://school.test', token: 'old' });
  });

  it('tells sealed, plain (saved before encryption) and corrupt values apart', async () => {
    setKeyStore(memoryStore());
    const sealed = await seal({ baseUrl: 'https://school.test', token: 'T' });
    expect(parseStored(JSON.stringify(sealed))).toEqual({ sealed });
    expect(parseStored('{"baseUrl":"https://school.test","token":"T"}')).toEqual({ plain: { baseUrl: 'https://school.test', token: 'T' } });
    expect(parseStored('not json')).toBeNull();
    expect(parseStored('{"baseUrl":1}')).toBeNull();
    expect(parseStored(null)).toBeNull();
  });

  it('says when there is nowhere to keep the key', () => {
    setKeyStore(null);
    expect(vaultAvailable()).toBe(false);
    setKeyStore(memoryStore());
    expect(vaultAvailable()).toBe(true);
  });
});

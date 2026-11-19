import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIE, forgetCookieKey, seal, setKeyStore, type KeyStore } from '../lib/tokenVault';
import { AuthProvider, useAuth } from './AuthContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'courseline.credentials';

function memoryStore(): KeyStore {
  let key: CryptoKey | undefined;
  return { get: async () => key, put: async (k) => void (key = k) };
}

function Probe() {
  const a = useAuth();
  return (
    <div>
      <p>{[a.status, a.token ?? '-'].join('|')}</p>
      <button onClick={() => a.login('https://school.test', 'typed-token')}>login</button>
      <button onClick={a.logout}>logout</button>
    </div>
  );
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

async function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  await settle();
  const press = async (label: string) => {
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === label)!.click());
    await settle();
  };
  return { text: () => el.querySelector('p')?.textContent, press, unmount: () => act(() => root.unmount()) };
}

let auths: string[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_CANVAS_BASE_URL', '');
  vi.stubEnv('VITE_CANVAS_API_TOKEN', '');
  auths = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    auths.push(new Headers(init?.headers).get('Authorization') ?? '');
    return new Response(JSON.stringify({ id: 1, name: 'Sam' }), { status: 200 });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setKeyStore(null);
  forgetCookieKey();
});

describe('AuthContext: the saved token is encrypted', () => {
  it('saves a typed token sealed, and signs in from it on the next visit', async () => {
    setKeyStore(memoryStore());
    const first = await mount();
    await first.press('login');
    expect(first.text()).toBe('authenticated|typed-token');
    const saved = localStorage.getItem(KEY)!;
    expect(saved).not.toContain('typed-token');
    expect(JSON.parse(saved)).toMatchObject({ v: 2, baseUrl: 'https://school.test' });
    await first.unmount();

    const second = await mount();
    expect(second.text()).toBe('authenticated|typed-token');
    expect(auths.at(-1)).toBe('Bearer typed-token');
    await second.unmount();
  });

  it('seals a token that was saved in plain text before', async () => {
    setKeyStore(memoryStore());
    localStorage.setItem(KEY, JSON.stringify({ baseUrl: 'https://school.test', token: 'old-plain' }));
    const m = await mount();
    expect(m.text()).toBe('authenticated|old-plain');
    expect(localStorage.getItem(KEY)).not.toContain('old-plain');
    expect(JSON.parse(localStorage.getItem(KEY)!).v).toBe(2);
    await m.unmount();
  });

  it('asks to sign in again when the key is gone, and forgets the sealed token', async () => {
    setKeyStore(memoryStore());
    localStorage.setItem(KEY, JSON.stringify(await seal({ baseUrl: 'https://school.test', token: 'T' })));
    setKeyStore(memoryStore()); // site data partly cleared: the key went, the ciphertext stayed
    const m = await mount();
    expect(m.text()).toBe('unauthenticated|-');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(auths).toEqual([]);
    await m.unmount();
  });

  it('asks to sign in again when the cookies were cleared', async () => {
    setKeyStore(memoryStore());
    localStorage.setItem(KEY, JSON.stringify(await seal({ baseUrl: 'https://school.test', token: 'T' })));
    forgetCookieKey();
    const m = await mount();
    expect(m.text()).toBe('unauthenticated|-');
    expect(localStorage.getItem(KEY)).toBeNull();
    await m.unmount();
  });

  it('signing out forgets the cookie secret too', async () => {
    setKeyStore(memoryStore());
    const m = await mount();
    await m.press('login');
    expect(document.cookie).toContain(COOKIE);
    await m.press('logout');
    expect(document.cookie).not.toContain(COOKIE);
    expect(localStorage.getItem(KEY)).toBeNull();
    await m.unmount();
  });

  it('with nowhere to keep a key, signs in for this visit only and saves nothing in plain text', async () => {
    setKeyStore(null);
    const m = await mount();
    await m.press('login');
    expect(m.text()).toBe('authenticated|typed-token');
    expect(localStorage.getItem(KEY)).toBeNull();
    await m.unmount();
  });

  it('signing out right after signing in does not leave the token saved', async () => {
    setKeyStore(memoryStore());
    const m = await mount();
    await act(async () => {
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'login')!.click();
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'logout')!.click();
    });
    await settle();
    expect(localStorage.getItem(KEY)).toBeNull();
    await m.unmount();
  });
});

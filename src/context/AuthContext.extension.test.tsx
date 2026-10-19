import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = (kind: string, courseId: number | null, body: unknown) => ({ kind, courseId, host: 'school.test', url: 'u', capturedAt: Date.now(), body });
const snapshot = {
  records: [record('dashboardCards', null, [{ id: '1', longName: 'Biology' }]), record('course', 1, { id: 1, name: 'Biology', enrollments: [{ type: 'student', user_id: 42 }] })],
  health: {},
  takenAt: 1,
};

function fakeBridge(reply: unknown = snapshot) {
  const handler = (event: MessageEvent) => {
    const m = event.data as { source?: string; id?: string; type?: string };
    if (m?.source !== 'courseline-app' || m.type !== 'snapshot') return;
    window.postMessage({ source: 'courseline-extension', id: m.id, ...(reply as object) }, window.location.origin);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

function Probe() {
  const a = useAuth();
  return (
    <div>
      <p data-testid="out">{[a.status, a.source, a.baseUrl ?? '-', a.extensionAvailable ? 'avail' : 'no'].join('|')}</p>
      <button onClick={a.enableExtension}>switch</button>
    </div>
  );
}

async function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<AuthProvider><Probe /></AuthProvider>));
  // Let the snapshot request and the profile check settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return {
    text: () => el.querySelector('p')?.textContent,
    switchToExtension: async () => {
      await act(async () => el.querySelector('button')!.click());
      await act(async () => void (await new Promise((r) => setTimeout(r, 30))));
    },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_CANVAS_BASE_URL', '');
  vi.stubEnv('VITE_CANVAS_API_TOKEN', '');
});
afterEach(() => {
  delete document.documentElement.dataset.courselineExtension;
  localStorage.clear();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
});

describe('signing in with the extension', () => {
  it('signs in from captured data when there is no token', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const stop = fakeBridge();
    const m = await mount();
    stop();
    expect(m.text()).toBe('authenticated|extension|https://school.test|no');
    await m.unmount();
  });

  it('shows the login page when the extension has captured nothing', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const stop = fakeBridge({ records: [], health: {}, takenAt: 1 });
    const m = await mount();
    stop();
    expect(m.text()).toContain('unauthenticated|token');
    await m.unmount();
  });

  it('does nothing when the extension is not installed', async () => {
    const m = await mount();
    expect(m.text()).toBe('unauthenticated|token|-|no');
    await m.unmount();
  });

  it('respects a saved choice to use a token, and offers the extension again', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    localStorage.setItem('courseline.skip-extension', '1');
    const m = await mount();
    expect(m.text()).toBe('unauthenticated|token|-|avail');
    await m.unmount();
  });

  it('switching to the extension forgets a saved token and signs in from the captured data', async () => {
    localStorage.setItem('courseline.credentials', JSON.stringify({ baseUrl: 'https://school.test', token: 'abc' }));
    document.documentElement.dataset.courselineExtension = '0.1.0';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 1, name: 'Sam' }), { status: 200 })));
    const stop = fakeBridge();
    const m = await mount();
    expect(m.text()).toContain('authenticated|token');
    await m.switchToExtension();
    stop();
    expect(localStorage.getItem('courseline.credentials')).toBeNull();
    expect(m.text()).toBe('authenticated|extension|https://school.test|no');
    await m.unmount();
    vi.unstubAllGlobals();
  });

  it('pressing Connect with nothing captured yet does not strand the app on the loading screen', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const stop = fakeBridge({ records: [], health: {}, takenAt: 1 });
    const m = await mount();
    expect(m.text()).toContain('unauthenticated|token');
    await m.switchToExtension(); // what Connect does
    stop();
    expect(m.text()).toContain('unauthenticated|token'); // back on the login page, not stuck on "loading"
    await m.unmount();
  });
});

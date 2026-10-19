import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ error: null, status: 'unauthenticated', login: vi.fn(), enableExtension: vi.fn() }) }));
vi.mock('../context/PullContext', () => ({ usePull: () => ({ requestSync: vi.fn() }) }));
// No mock of the course filter: on the real login page there is no CourseFilterProvider, and nothing there may need one.

async function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter><LoginPage /></MemoryRouter>));
  return { el, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  delete document.documentElement.dataset.courselineExtension;
  document.body.innerHTML = '';
});

describe('LoginPage', () => {
  it('leads with the token form when the extension is not installed, and offers the extension below', async () => {
    const v = await mount();
    const text = v.el.textContent ?? '';
    expect(text).toContain('Access token');
    expect(text).toContain('No access token? Use the browser extension');
    expect(v.el.querySelector('input[type="password"]')).not.toBeNull();
    await v.unmount();
  });

  it('leads with the extension when it is installed, and keeps the token form one click away', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const v = await mount();
    const text = v.el.textContent ?? '';
    expect(text).toContain('Your Canvas address');
    expect(text).toContain('Connect and load my courses');
    expect(text).toContain('Sign in with an access token instead');
    await v.unmount();
  });
});

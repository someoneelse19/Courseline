import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionInstalled } from '../extension/bridge';
import { LoginPage } from './LoginPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The API-token edition (the main branch): see src/edition.ts.
vi.mock('../edition', () => ({ API_ONLY: true }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ error: null, status: 'unauthenticated', login: vi.fn(), enableExtension: vi.fn() }) }));
vi.mock('../context/PullContext', () => ({ usePull: () => ({ requestSync: vi.fn() }) }));

afterEach(() => {
  delete document.documentElement.dataset.courselineExtension;
  document.body.innerHTML = '';
});

describe('API-token edition', () => {
  it('offers only the token form and never sees the extension, even when it is installed', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    expect(extensionInstalled()).toBe(false);
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => root.render(<MemoryRouter><LoginPage /></MemoryRouter>));
    const text = el.textContent ?? '';
    expect(text).toContain('Access token');
    expect(text).not.toMatch(/extension/i);
    expect(el.querySelector('input[type="password"]')).not.toBeNull();
    act(() => root.unmount());
  });
});

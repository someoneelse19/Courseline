import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasConnection } from './CanvasConnection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const enableExtension = vi.fn();
const requestSync = vi.fn();
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ enableExtension }) }));
vi.mock('../context/PullContext', () => ({ usePull: () => ({ requestSync }) }));
vi.mock('../context/CourseFilterContext', () => ({ useOptionalCourseFilter: () => ({ selected: null }) }));

// Plays the extension's bridge.js: keeps a Canvas address and some captured records, and logs what the app asked for.
let state: { canvasHost: string | null; records: unknown[]; appPinned: number[] | null };
let asked: string[];
function fakeBridge() {
  const handler = (event: MessageEvent) => {
    const m = event.data as { source?: string; id?: string; type?: string; input?: string };
    if (m?.source !== 'courseline-app') return;
    asked.push(m.type === 'setCanvasHost' ? `setCanvasHost:${m.input}` : String(m.type));
    let reply: object = { ok: true };
    if (m.type === 'snapshot') reply = { records: state.records, health: {}, appPinned: state.appPinned, canvasHost: state.canvasHost, takenAt: 1 };
    if (m.type === 'setCanvasHost') {
      if (/^http:/.test(m.input ?? '')) reply = { ok: false, error: 'Canvas uses https.' };
      else {
        state.canvasHost = (m.input ?? '').replace(/^https:\/\//, '').replace(/\/$/, '') || null;
        reply = { ok: true, host: state.canvasHost };
      }
    }
    window.postMessage({ source: 'courseline-extension', id: m.id, ...reply }, window.location.origin);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

let stop: () => void;
beforeEach(() => {
  state = { canvasHost: null, records: [], appPinned: null };
  asked = [];
  enableExtension.mockClear();
  requestSync.mockClear();
  stop = fakeBridge();
});
afterEach(() => {
  stop();
  delete document.documentElement.dataset.courselineExtension;
  document.body.innerHTML = '';
});

async function mount(variant: 'login' | 'settings') {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<MemoryRouter><CanvasConnection variant={variant} /></MemoryRouter>));
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  const type = async (value: string) => {
    const input = el.querySelector('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const click = async (label: RegExp) => {
    const button = [...el.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''));
    expect(button, `button ${label}`).toBeTruthy();
    await act(async () => {
      button!.click();
      await new Promise((r) => setTimeout(r, 30));
    });
  };
  return { el, type, click, text: () => el.textContent ?? '', unmount: () => act(() => root.unmount()) };
}

describe('CanvasConnection', () => {
  it('explains how to install the extension when it is not there', async () => {
    const v = await mount('login');
    expect(v.text()).toContain('chrome://extensions');
    expect(v.el.querySelector('input')).toBeNull();
    await v.unmount();
  });

  it('login: saves the address, switches to the extension and loads the essentials in the background when nothing is captured', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const v = await mount('login');
    await v.type('https://school.instructure.com/');
    await v.click(/Connect and load my courses/);
    expect(asked).toContain('setCanvasHost:https://school.instructure.com/');
    expect(enableExtension).toHaveBeenCalledTimes(1);
    expect(requestSync).toHaveBeenCalledWith({ confirm: false, depth: 'essential', depthChoice: false });
    expect(v.text()).toContain('Loading your Canvas data in the background');
    await v.unmount();
  });

  it('login: shows the extension\'s error and does not switch when the address is refused', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const v = await mount('login');
    await v.type('http://school.instructure.com');
    await v.click(/Connect and load my courses/);
    expect(v.text()).toContain('Canvas uses https.');
    expect(enableExtension).not.toHaveBeenCalled();
    expect(requestSync).not.toHaveBeenCalled();
    await v.unmount();
  });

  it('login: with data already captured it just signs in, without opening a sync', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    state = { canvasHost: 'school.instructure.com', records: [{ kind: 'course', courseId: 1, host: 'h', url: 'u', capturedAt: 1, body: {} }], appPinned: null };
    const v = await mount('login');
    await v.click(/Sign in with the extension/);
    expect(enableExtension).toHaveBeenCalled();
    expect(requestSync).not.toHaveBeenCalled();
    await v.unmount();
  });

  it('settings: shows each step with its state and offers Save address and Sync now', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    state = { canvasHost: 'school.instructure.com', records: [{ kind: 'course', courseId: 1, host: 'h', url: 'u', capturedAt: Date.now(), body: {} }], appPinned: [1, 2] };
    const v = await mount('settings');
    expect(v.text()).toContain('The Courseline extension is connected');
    expect(v.text()).toContain('1 response captured');
    expect(v.text()).toContain('2 courses chosen');
    expect((v.el.querySelector('input') as HTMLInputElement).value).toBe('school.instructure.com');
    await v.click(/Save address/);
    expect(asked).toContain('setCanvasHost:school.instructure.com');
    await v.click(/Sync now/);
    expect(requestSync).toHaveBeenCalledWith();
    await v.unmount();
  });

  it('login: an untouched field never replaces the saved address (the extension may not have answered yet)', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    state = { canvasHost: 'school.instructure.com', records: [{ kind: 'course', courseId: 1, host: 'h', url: 'u', capturedAt: 1, body: {} }], appPinned: null };
    const v = await mount('login');
    await v.click(/Sign in with the extension/);
    expect(asked.some((a) => a.startsWith('setCanvasHost'))).toBe(false); // nothing was saved, so nothing was overwritten
    expect(state.canvasHost).toBe('school.instructure.com');
    expect(enableExtension).toHaveBeenCalled();
    await v.unmount();
  });

  it('login: an empty field is refused, not saved as "no address"', async () => {
    document.documentElement.dataset.courselineExtension = '0.1.0';
    const v = await mount('login'); // nothing saved yet, nothing typed
    await v.click(/Connect and load my courses/);
    expect(v.text()).toContain('Enter your Canvas address.');
    expect(asked.some((a) => a.startsWith('setCanvasHost'))).toBe(false);
    expect(enableExtension).not.toHaveBeenCalled();
    await v.unmount();
  });
});

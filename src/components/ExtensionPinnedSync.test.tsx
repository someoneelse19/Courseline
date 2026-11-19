import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../extension/bridge';
import { resetHiddenCommunities, setCommunityHidden } from '../lib/communities';
import { ExtensionPinnedSync } from './ExtensionPinnedSync';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent: Array<number[] | null> = [];
const sentCommunities: Array<number[] | null> = [];
vi.mock('../extension/bridge', () => ({
  setPinnedCourses: async (ids: number[] | null) => void sent.push(ids),
  setCommunityCourses: async (ids: number[] | null) => void sentCommunities.push(ids),
}));
let communities: Array<{ id: number }> | undefined;
vi.mock('../hooks/useCanvasData', () => ({ useCommunities: () => ({ data: communities }) }));

let auth: { source: string; snapshot: Snapshot | null };
let selected: Set<number> | null;
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/CourseFilterContext', () => ({ useCourseFilter: () => ({ selected }) }));

const snapshot = (appPinned: number[] | null, appCommunities: number[] | null = null): Snapshot => ({ records: [], health: {}, appPinned, appCommunities, canvasHost: null, takenAt: 1 });

async function mount() {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(<ExtensionPinnedSync />));
  return { unmount: () => act(() => root.unmount()) };
}

beforeEach(() => {
  sent.length = 0;
  sentCommunities.length = 0;
  communities = undefined;
});
afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  resetHiddenCommunities();
});

describe('ExtensionPinnedSync', () => {
  it('sends the selection when the extension has a different one', async () => {
    auth = { source: 'extension', snapshot: snapshot(null) };
    selected = new Set([3, 1]);
    const m = await mount();
    expect(sent).toEqual([[1, 3]]);
    await m.unmount();
  });

  it('does nothing once both sides agree, whatever the order', async () => {
    auth = { source: 'extension', snapshot: snapshot([3, 1]) };
    selected = new Set([1, 3]);
    const m = await mount();
    expect(sent).toEqual([]);
    await m.unmount();
  });

  it('clears the extension\'s choice when nothing is selected in the app', async () => {
    auth = { source: 'extension', snapshot: snapshot([5]) };
    selected = null;
    const m = await mount();
    expect(sent).toEqual([null]);
    await m.unmount();
  });

  it('does nothing in token mode', async () => {
    auth = { source: 'token', snapshot: null };
    selected = new Set([1]);
    const m = await mount();
    expect(sent).toEqual([]);
    await m.unmount();
  });

  it('tells the extension to keep the communities the student has not hidden', async () => {
    auth = { source: 'extension', snapshot: snapshot([1]) };
    selected = new Set([1]);
    communities = [{ id: 9 }, { id: 4 }, { id: 7 }];
    setCommunityHidden(7, true);
    const m = await mount();
    expect(sentCommunities).toEqual([[4, 9]]);
    await m.unmount();
  });

  it('sends no communities again once the extension has them', async () => {
    auth = { source: 'extension', snapshot: snapshot([1], [9, 4]) };
    selected = new Set([1]);
    communities = [{ id: 4 }, { id: 9 }];
    const m = await mount();
    expect(sentCommunities).toEqual([]);
    await m.unmount();
  });
});

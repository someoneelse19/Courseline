import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CourseStyleProvider, useCourseStyles } from './CourseStyleContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useCourseStyles>;
function Probe() {
  api = useCourseStyles();
  return null;
}

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const mount = () => act(async () => root.render(<CourseStyleProvider><Probe /></CourseStyleProvider>));

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
});

describe('course styles', () => {
  it('saves a color and icon per course and merges later changes', async () => {
    await mount();
    await act(async () => api.setStyle(5, { color: '#112233' }));
    await act(async () => api.setStyle(5, { icon: 'music' }));
    expect(api.styles[5]).toEqual({ color: '#112233', icon: 'music' });
    expect(JSON.parse(localStorage.getItem('courseline.course-styles')!)).toEqual({ 5: { color: '#112233', icon: 'music' } });
  });

  it('reset returns a course to the automatic style without touching others', async () => {
    await mount();
    await act(async () => api.setStyle(1, { icon: 'art' }));
    await act(async () => api.setStyle(2, { icon: 'code' }));
    await act(async () => api.reset(1));
    expect(api.styles[1]).toBeUndefined();
    expect(api.styles[2]).toEqual({ icon: 'code' });
  });

  it('loads what was saved and ignores invalid entries', async () => {
    localStorage.setItem('courseline.course-styles', JSON.stringify({ 1: { color: '#ABCDEF', icon: 'globe' }, 2: { color: 'red', icon: 'nope' } }));
    await mount();
    expect(api.styles).toEqual({ 1: { color: '#abcdef', icon: 'globe' } });
  });
});

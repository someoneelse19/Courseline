import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Submission } from '../api/types';
import { SubmissionView } from './AssignmentFeedback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const openFile = vi.fn();
vi.mock('../context/FileViewerContext', () => ({ useFileViewer: () => ({ openFile }) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ baseUrl: 'https://school.test' }) }));

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  openFile.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const sub = (o: Partial<Submission>): Submission =>
  ({ id: 1, assignment_id: 5, user_id: 9, workflow_state: 'submitted', submitted_at: '2026-11-01T10:00:00Z', attempt: 1, ...o }) as Submission;
const render = (s: Submission) => act(async () => root.render(<SubmissionView sub={s} points={10} />));
const dialog = () => document.querySelector('[role=dialog]');

describe('SubmissionView', () => {
  it('shows files as cards (kind icon, name, size) that open in the viewer', async () => {
    await render(sub({ attachments: [{ id: 3, display_name: 'essay.pdf', url: 'https://files.test/essay.pdf?verifier=x', size: 2048 }] }));
    const card = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('essay.pdf'))!;
    expect(card.textContent).toContain('📕');
    expect(card.textContent).toContain('2 KB');
    await act(async () => void card.click());
    expect(openFile).toHaveBeenCalledWith('https://files.test/essay.pdf?verifier=x', 'essay.pdf', undefined);
  });

  it('opens a long text submission whole in an overlay instead of another page', async () => {
    const long = `<p>${'word '.repeat(100)}THE END</p>`;
    await render(sub({ body: long }));
    expect(host.textContent).not.toContain('THE END'); // cut short in the card
    expect(host.querySelector('a[href$="/submission"]')).toBeNull();
    await act(async () => void [...host.querySelectorAll('button')].find((b) => b.textContent === '...view full submission')!.click());
    expect(dialog()?.textContent).toContain('THE END');
    await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(dialog()).toBeNull();
  });
});

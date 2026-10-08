import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assignment } from '../api/types';
import { SubmissionForm } from './SubmissionForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The form only talks to Canvas through the API object, so a fake one is all it needs.
const api = { uploadSubmissionFile: vi.fn(), submitAssignment: vi.fn() };
vi.mock('../context/AuthContext', () => ({ useApi: () => api }));

const assignment = (o: Partial<Assignment> = {}): Assignment => ({
  id: 2, course_id: 1, name: 'A', due_at: null, points_possible: 10, html_url: '', submission_types: ['online_upload', 'online_text_entry'], ...o,
});

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
const onSubmitted = vi.fn();
const render = async (a = assignment()) => {
  await act(async () => root.render(<SubmissionForm courseId={1} assignmentId={2} assignment={a} onSubmitted={onSubmitted} />));
};
const q = <T extends Element>(sel: string) => host.querySelector<T>(sel);
const text = () => host.textContent ?? '';
const pick = async (...names: string[]) => {
  const input = q<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: names.map((n) => new File(['x'], n)) });
  await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
};
const submit = async () => act(async () => void q<HTMLButtonElement>('button[type=submit]')!.click());
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))!;

beforeEach(() => {
  api.uploadSubmissionFile.mockReset();
  api.submitAssignment.mockReset().mockResolvedValue({});
  onSubmitted.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SubmissionForm: file upload', () => {
  it('uploads every file in order, then submits all their ids together', async () => {
    api.uploadSubmissionFile.mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ id: 12 });
    await render();
    await pick('a.txt', 'b.pdf');
    await submit();
    expect(api.uploadSubmissionFile.mock.calls.map((c) => (c[2] as File).name)).toEqual(['a.txt', 'b.pdf']);
    expect(api.submitAssignment).toHaveBeenCalledWith(1, 2, { submission_type: 'online_upload', file_ids: [11, 12] });
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(q('ul')).toBeNull(); // the list clears after a successful submit
  });

  it('submits nothing when any upload fails, says so, and a retry only re-uploads the failed file', async () => {
    api.uploadSubmissionFile.mockResolvedValueOnce({ id: 11 }).mockRejectedValueOnce(new Error('storage said no')).mockResolvedValueOnce({ id: 12 });
    await render();
    await pick('ok.txt', 'bad.txt');
    await submit();
    expect(api.submitAssignment).not.toHaveBeenCalled();
    expect(text()).toContain('1 file could not be uploaded, so nothing was submitted');
    expect(text()).toContain('storage said no');
    expect(text()).toContain('✓ Uploaded');

    await submit(); // retry
    expect(api.uploadSubmissionFile).toHaveBeenCalledTimes(3); // ok.txt once, bad.txt twice
    expect(api.submitAssignment).toHaveBeenCalledWith(1, 2, { submission_type: 'online_upload', file_ids: [11, 12] });
  });

  it('lets you remove a file before submitting', async () => {
    api.uploadSubmissionFile.mockResolvedValue({ id: 1 });
    await render();
    await pick('a.txt', 'b.txt');
    await act(async () => void q<HTMLButtonElement>('button[aria-label="Remove a.txt"]')!.click());
    await submit();
    expect(api.uploadSubmissionFile).toHaveBeenCalledTimes(1);
    expect((api.uploadSubmissionFile.mock.calls[0][2] as File).name).toBe('b.txt');
  });

  it('flags files of a type the assignment does not allow, and uploads none until they are removed', async () => {
    await render(assignment({ allowed_extensions: ['pdf', '.docx'] }));
    await pick('essay.pdf', 'notes.txt');
    expect(text()).toContain('Not an allowed file type (allowed: pdf, docx)');
    await submit();
    expect(api.uploadSubmissionFile).not.toHaveBeenCalled();
    expect(text()).toContain('Remove the files with the wrong type');
  });

  it('keeps Submit disabled until a file is chosen', async () => {
    await render();
    expect(q<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    await pick('a.txt');
    expect(q<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  });
});

describe('SubmissionForm: text entry', () => {
  it('submits the text', async () => {
    await render();
    await act(async () => void button('Text entry').click());
    const box = q<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'my answer');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submit();
    expect(api.submitAssignment).toHaveBeenCalledWith(1, 2, { submission_type: 'online_text_entry', body: 'my answer' });
    expect(api.uploadSubmissionFile).not.toHaveBeenCalled();
  });

  it('shows only the tabs the assignment accepts', async () => {
    await render(assignment({ submission_types: ['online_text_entry'] }));
    expect(button('File upload')).toBeUndefined();
    expect(q('textarea')).not.toBeNull(); // opens on the only available tab
  });

  it('renders nothing for assignments that take neither', async () => {
    await render(assignment({ submission_types: ['on_paper'] }));
    expect(host.innerHTML).toBe('');
  });
});

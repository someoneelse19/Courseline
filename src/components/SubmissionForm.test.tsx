import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assignment } from '../api/types';
import { SubmissionForm } from './SubmissionForm';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The form only talks to Canvas through the API object, so a fake one is all it needs.
const api = { uploadSubmissionFile: vi.fn(), submitAssignment: vi.fn(), uploadEditorFile: vi.fn() };
vi.mock('../context/AuthContext', () => ({ useApi: () => api, useAuth: () => ({ baseUrl: 'https://school.test', user: { id: 5 } }) }));
// The real editor (Tiptap) has its own test (RichTextEditor.test.tsx); here a plain box stands in for it.
vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (html: string) => void }) => (
    <textarea data-testid="editor" defaultValue={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('./HtmlContent', () => ({ HtmlContent: ({ html }: { html: string }) => <div data-testid="preview">{html}</div> }));

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
  localStorage.clear();
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
    expect(text()).toContain('Uploaded');

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
  const openEditor = async () => {
    await act(async () => void button('Text entry').click());
    await act(async () => void button('Open the editor').click());
    await act(async () => {}); // the lazy editor resolves
  };
  const type = async (html: string) => {
    const box = q<HTMLTextAreaElement>('[data-testid=editor]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(box, html);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  /** The overlay's Submit button (the last submit button on the page while it is open). */
  const overlaySubmit = () => [...host.querySelectorAll<HTMLButtonElement>('button[type=submit]')].at(-1)!;

  it('writes in an overlay and submits the formatted text as HTML from it', async () => {
    await render();
    await openEditor();
    expect(q('[role=dialog]')).not.toBeNull();
    await type('<p>my <strong>answer</strong></p>');
    await act(async () => void overlaySubmit().click());
    expect(api.submitAssignment).toHaveBeenCalledWith(1, 2, { submission_type: 'online_text_entry', body: '<p>my <strong>answer</strong></p>' });
    expect(api.uploadSubmissionFile).not.toHaveBeenCalled();
    expect(q('[role=dialog]')).toBeNull(); // closes after a successful submit
    expect(localStorage.getItem('courseline.draft.1.2')).toBeNull(); // and the draft is gone
  });

  it('strips scripts and event handlers before submitting', async () => {
    await render();
    await openEditor();
    await type('<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>');
    await act(async () => void overlaySubmit().click());
    const body = api.submitAssignment.mock.calls[0][2].body as string;
    expect(body).toContain('hi');
    expect(body).not.toMatch(/script|onclick|javascript:/);
  });

  it('keeps Submit disabled while the editor has no visible text', async () => {
    await render();
    await openEditor();
    await type('<p><br></p>');
    expect(overlaySubmit().disabled).toBe(true);
    await type('<p>x</p>');
    expect(overlaySubmit().disabled).toBe(false);
  });

  it('keeps the draft when the editor closes, shows it in the card, and restores it on the next visit', async () => {
    await render();
    await openEditor();
    await type('<p>half an essay</p>');
    await act(async () => void button('Done').click());
    expect(q('[role=dialog]')).toBeNull();
    expect(q('[data-testid=preview]')!.textContent).toContain('half an essay');
    expect(text()).toContain('3 words');
    expect(localStorage.getItem('courseline.draft.1.2')).toBe('<p>half an essay</p>');

    act(() => root.unmount());
    root = createRoot(host);
    await render(assignment({ submission_types: ['online_text_entry'] }));
    expect(q('[data-testid=preview]')!.textContent).toContain('half an essay');
    await act(async () => void button('Continue editing').click());
    await act(async () => {});
    expect(q<HTMLTextAreaElement>('[data-testid=editor]')!.value).toBe('<p>half an essay</p>');
  });

  it('can submit a draft from the card without reopening the editor', async () => {
    localStorage.setItem('courseline.draft.1.2', '<p>ready</p>');
    await render(assignment({ submission_types: ['online_text_entry'] }));
    await submit();
    expect(api.submitAssignment).toHaveBeenCalledWith(1, 2, { submission_type: 'online_text_entry', body: '<p>ready</p>' });
  });

  it('shows only the tabs the assignment accepts', async () => {
    await render(assignment({ submission_types: ['online_text_entry'] }));
    expect(button('File upload')).toBeUndefined();
    expect(button('Open the editor')).toBeDefined(); // opens on the only available tab
  });

  it('renders nothing for assignments that take neither', async () => {
    await render(assignment({ submission_types: ['on_paper'] }));
    expect(host.innerHTML).toBe('');
  });
});

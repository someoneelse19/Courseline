import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RichTextEditor } from './RichTextEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real Tiptap editor in jsdom: its toolbar turns the selection into the HTML Canvas's editor writes.

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
let onChange: ReturnType<typeof vi.fn<(html: string) => void>>;
const last = () => onChange.mock.calls.at(-1)?.[0] as string;
const click = async (title: string) => {
  const b = host.querySelector<HTMLButtonElement>(`button[title^="${title}"]`);
  if (!b) throw new Error(`no button "${title}"`);
  await act(async () => void b.click());
};
const selectAll = async () => {
  const box = host.querySelector<HTMLElement>('[contenteditable]')!;
  // Select the text in the page; the editor picks up the browser's selection.
  await act(async () => {
    box.focus();
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 30));
  });
};

beforeEach(async () => {
  // jsdom has no layout; ProseMirror asks for rectangles when it scrolls the selection into view.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
  document.elementFromPoint = () => null;
  onChange = vi.fn<(html: string) => void>();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<RichTextEditor value="<p>hello world</p>" onChange={onChange} ariaLabel="Answer" baseUrl="https://school.test" userId={5} upload={vi.fn()} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('RichTextEditor', () => {
  it('starts with the given HTML and shows the word count and element path', () => {
    expect(host.querySelector('[contenteditable]')!.innerHTML).toContain('hello world');
    expect(host.textContent).toContain('2 words');
  });

  it('formats the selection: bold, then a heading, then centered', async () => {
    await selectAll();
    await click('Bold');
    expect(last()).toBe('<p><strong>hello world</strong></p>');
    await click('Blocks');
    await act(async () => void [...host.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find((b) => b.textContent === 'Heading 3')!.click());
    expect(last()).toBe('<h3><strong>hello world</strong></h3>');
    await click('Align');
    await act(async () => void [...host.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find((b) => b.textContent?.includes('Align center'))!.click());
    expect(last()).toBe('<h3 style="text-align: center;"><strong>hello world</strong></h3>');
  });

  it('makes a numbered list with Canvas’s marker styles, and indents paragraphs by 40px', async () => {
    await selectAll();
    await click('Increase indent');
    expect(last()).toBe('<p style="padding-left: 40px;">hello world</p>');
    await click('Numbered list: style');
    await act(async () => void [...host.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find((b) => b.textContent === 'Upper roman')!.click());
    expect(last()).toMatch(/^<ol style="list-style-type: upper-roman;"><li><p[^>]*>hello world<\/p><\/li><\/ol>$/);
  });

  it('colors text and sets right-to-left', async () => {
    await selectAll();
    await click('Text color');
    await act(async () => void host.querySelector<HTMLButtonElement>('button[title="#e03e2d"]')!.click());
    expect(last()).toBe('<p><span style="color: rgb(224, 62, 45);">hello world</span></p>');
    await click('Right-to-left');
    expect(last()).toContain('dir="rtl"');
  });

  it('inserts a table, and shows the table tools while in it', async () => {
    await click('Table');
    await act(async () => void [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Insert table')!.click());
    expect(last()).toContain('<table');
    expect(last()).toContain('<th');
    expect(host.querySelector('[role=toolbar][aria-label=Table]')).not.toBeNull();
  });

  it('switches to the HTML view and back, cleaning what was typed', async () => {
    await click('Edit the HTML');
    const area = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="HTML editor"]')!;
    expect(area.value).toContain('<p>hello world</p>');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '<p>new <em>text</em></p><script>x()</script>');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('Back to the rich text editor');
    expect(host.querySelector('[contenteditable]')!.innerHTML).toContain('new <em>text</em>');
    expect(last()).not.toContain('script');
  });
});

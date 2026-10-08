import { useEffect, useRef, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { t } from '../i18n';

// A small contentEditable editor (no editor library). Uses document.execCommand: deprecated on
// paper, but still implemented by every browser and the simplest way to get bold/lists/links.
// Its output is HTML, which is what Canvas expects for a text-entry submission. Always run it
// through cleanEditorHtml() before sending or rendering it.

const ALLOWED_TAGS = ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'blockquote'];

export function cleanEditorHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR: ['href'] }).trim();
}

/** True when there is nothing a reader would see (tags with no text count as empty). */
export function isEditorEmpty(html: string): boolean {
  const probe = document.createElement('div');
  probe.innerHTML = cleanEditorHtml(html);
  return probe.textContent?.trim() === '';
}

interface RichTextEditorProps {
  /** Current HTML. Only read to reset the editor: pass '' to clear it. */
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  placeholder?: string;
}

const COMMANDS: { label: string; title: string; command: string; arg?: string; content: ReactNode }[] = [
  { label: 'Bold', title: 'Bold', command: 'bold', content: <b>B</b> },
  { label: 'Italic', title: 'Italic', command: 'italic', content: <i>I</i> },
  { label: 'Underline', title: 'Underline', command: 'underline', content: <u>U</u> },
  { label: 'Bulleted list', title: 'Bulleted list', command: 'insertUnorderedList', content: '• List' },
  { label: 'Numbered list', title: 'Numbered list', command: 'insertOrderedList', content: '1. List' },
  { label: 'Quote', title: 'Quote', command: 'formatBlock', arg: 'blockquote', content: '“ ”' },
];

export function RichTextEditor({ value, onChange, ariaLabel, placeholder }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);

  // The DOM owns the content while typing; only an external reset to '' needs pushing in.
  useEffect(() => {
    if (value === '' && ref.current && ref.current.innerHTML !== '') ref.current.innerHTML = '';
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    // Browsers leave a lone <br> behind after deleting everything, which would hide the placeholder.
    if (!el.textContent) el.innerHTML = '';
    onChange(el.innerHTML);
  };

  const run = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt(t('Link address (https://…)'))?.trim();
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) {
      window.alert(t('Links must start with https://, http:// or mailto:'));
      return;
    }
    run('createLink', url);
  };

  const button = 'rounded-sm px-2 py-1 text-sm hover:bg-neutral-200 dark:hover:bg-neutral-700';

  return (
    <div className="rounded-md border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950">
      <div role="toolbar" aria-label={t('Text formatting')} className="flex flex-wrap gap-1 border-b border-neutral-200 p-1 dark:border-neutral-800">
        {COMMANDS.map((c) => (
          <button
            key={c.label}
            type="button"
            title={t(c.title)}
            aria-label={t(c.label)}
            // mousedown would move focus (and the selection) out of the editor before the click fires.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(c.command, c.arg)}
            className={button}
          >
            {typeof c.content === 'string' ? t(c.content) : c.content}
          </button>
        ))}
        <button type="button" title={t('Link')} aria-label={t('Link')} onMouseDown={(e) => e.preventDefault()} onClick={addLink} className={button}>
          🔗
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => {
          // Pasted HTML carries fonts, colors and page junk; keep only the text.
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        className="canvas-html min-h-48 max-w-none overflow-y-auto px-3 py-2 outline-none empty:before:text-neutral-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}

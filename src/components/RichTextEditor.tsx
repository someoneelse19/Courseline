import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { BackgroundColor, Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { TextAlign } from '@tiptap/extension-text-align';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableKit } from '@tiptap/extension-table';
import { Image as ImageNode } from '@tiptap/extension-image';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import type { UploadedFile } from '../api/client';
import { cleanEditorHtml, countWords, equationImageHtml } from '../lib/editorHtml';
import { t } from '../i18n';
import { UiIcon } from './icons';

// The text-entry editor, with the tools of Canvas's Rich Content Editor: block formats (paragraph, headings 2–4,
// preformatted), font size, bold/italic/underline/strikethrough, text and highlight color, superscript/subscript,
// alignment, bulleted and numbered lists with their marker styles, indent/outdent, left-to-right / right-to-left,
// links, images (upload or address), documents (upload), equations (LaTeX, drawn by Canvas as images), tables,
// horizontal line, clear formatting, undo/redo, an HTML view, the element path, a word count and the keyboard shortcuts.
// Built on Tiptap (ProseMirror); loaded only when the editor opens. Its HTML goes through cleanEditorHtml() on the way out.
// Not here (Canvas-only): recording media, apps (LTI tools), links to course content, the accessibility checker.

const MAX_INDENT = 8;
const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'bulletList', 'orderedList', 'tableCell', 'tableHeader'];

/** Attributes Canvas's editor writes that Tiptap does not: text direction, paragraph indentation, list marker style. */
const BlockExtras = Extension.create({
  name: 'blockExtras',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => (['ltr', 'rtl'].includes(el.getAttribute('dir') ?? '') ? el.getAttribute('dir') : null),
            renderHTML: (a) => (a.dir ? { dir: a.dir } : {}),
          },
        },
      },
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.min(MAX_INDENT, Math.round((parseInt(el.style.paddingLeft, 10) || 0) / 40)),
            renderHTML: (a) => (a.indent ? { style: `padding-left: ${a.indent * 40}px` } : {}),
          },
        },
      },
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          listStyleType: {
            default: null,
            parseHTML: (el) => el.style.listStyleType || null,
            renderHTML: (a) => (a.listStyleType ? { style: `list-style-type: ${a.listStyleType}` } : {}),
          },
        },
      },
    ];
  },
});

/** Images keep Canvas's equation markers, so an equation can be opened and edited again. */
const CanvasImage = ImageNode.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      class: { default: null },
      'data-equation-content': { default: null },
    };
  },
});

const FONT_SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '18pt', '24pt', '30pt', '36pt'];
const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#e03e2d', '#e67e23', '#f1c40f', '#2dc26b', '#3598db', '#b96ad9',
  '#ba372a', '#a35d00', '#9a7d00', '#169179', '#236fa1', '#843fa1',
];
const BULLET_STYLES: [string | null, string][] = [[null, 'Default'], ['circle', 'Circle'], ['square', 'Square']];
const NUMBER_STYLES: [string | null, string][] = [
  [null, 'Default'], ['lower-alpha', 'Lower alpha'], ['upper-alpha', 'Upper alpha'], ['lower-roman', 'Lower roman'], ['upper-roman', 'Upper roman'],
];
const EQUATION_SNIPPETS = ['\\frac{a}{b}', '\\sqrt{x}', 'x^{2}', 'x_{i}', '\\sum_{i=1}^{n}', '\\int_{a}^{b}', '\\lim_{x \\to \\infty}', '\\pi', '\\alpha', '\\beta', '\\theta', '\\Delta', '\\le', '\\ge', '\\ne', '\\pm', '\\times', '\\div', '\\infty', '\\rightarrow'];

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const SHORTCUTS: [string, string][] = [
  [`${mod}+B`, 'Bold'], [`${mod}+I`, 'Italic'], [`${mod}+U`, 'Underline'], [`${mod}+Shift+S`, 'Strikethrough'],
  [`${mod}+.`, 'Superscript'], [`${mod}+,`, 'Subscript'], [`${mod}+E`, 'Code'], [`${mod}+K`, 'Link'],
  [`${mod}+Alt+2…4`, 'Heading 2–4'], [`${mod}+Alt+0`, 'Paragraph'], [`${mod}+Alt+C`, 'Preformatted'],
  [`${mod}+Shift+7`, 'Numbered list'], [`${mod}+Shift+8`, 'Bulleted list'], ['Tab / Shift+Tab', 'Indent / outdent a list item'],
  [`${mod}+Shift+L / E / R / J`, 'Align left / center / right / justify'], [`${mod}+Shift+B`, 'Quote'],
  [`${mod}+Z`, 'Undo'], [`${mod}+Shift+Z`, 'Redo'], ['Shift+Enter', 'Line break'], ['Esc', 'Close the editor (the draft is kept)'],
];

type MenuId = 'block' | 'size' | 'color' | 'highlight' | 'align' | 'bullets' | 'numbers' | 'link' | 'image' | 'document' | 'equation' | 'table' | 'shortcuts';

interface RichTextEditorProps {
  /** The HTML to start with. Pass '' later to clear the editor. */
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Canvas's address: equations are drawn there, and uploaded files are linked there. */
  baseUrl: string | null;
  /** Your Canvas user id, for the address of an uploaded image or document. */
  userId: number | string | null;
  /** Uploads an image or document into your Canvas files. Without it, only images by address. */
  upload?: (file: File) => Promise<UploadedFile>;
}

export function RichTextEditor({ value, onChange, ariaLabel, placeholder, baseUrl, userId, upload }: RichTextEditorProps) {
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [rawHtml, setRawHtml] = useState('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['mailto'], HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } },
      }),
      TextStyle,
      Color,
      BackgroundColor,
      FontSize,
      Subscript,
      Superscript,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: false } }),
      CanvasImage.configure({ inline: true }),
      CharacterCount,
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      BlockExtras,
    ],
    content: value,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': ariaLabel,
        class: 'canvas-html rce-content min-h-full max-w-none px-6 py-4 outline-none',
      },
      handleKeyDown: (_view, e) => {
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
          setMenu('link');
          return true;
        }
        return false;
      },
    },
    // The empty paragraph Tiptap keeps after a last table, list or heading (so you can type below it) is not sent.
    onUpdate: ({ editor: ed }) => onChangeRef.current(ed.isEmpty ? '' : ed.getHTML().replace(/(<p><\/p>)+$/, '')),
  });

  // Cleared from outside (after a submit).
  useEffect(() => {
    if (editor && value === '' && !editor.isEmpty) editor.commands.clearContent();
  }, [editor, value]);

  if (!editor) return null;

  const toggleHtml = () => {
    if (htmlMode) {
      editor.commands.setContent(cleanEditorHtml(rawHtml), { emitUpdate: true });
      setHtmlMode(false);
    } else {
      setRawHtml(prettyHtml(editor.getHTML()));
      setMenu(null);
      setHtmlMode(true);
    }
  };

  const words = htmlMode ? countWords(htmlToText(rawHtml)) : editor.storage.characterCount.words();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!htmlMode && <Toolbar editor={editor} menu={menu} setMenu={setMenu} baseUrl={baseUrl} userId={userId} upload={upload} />}
      {!htmlMode && editor.isActive('table') && <TableBar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-neutral-950">
        {htmlMode ? (
          <textarea
            aria-label={t('HTML editor')}
            spellCheck={false}
            value={rawHtml}
            onChange={(e) => {
              setRawHtml(e.target.value);
              onChange(cleanEditorHtml(e.target.value));
            }}
            className="h-full w-full resize-none bg-transparent px-6 py-4 font-mono text-xs outline-none"
          />
        ) : (
          <EditorContent editor={editor} className="h-full" />
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-200 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        <span className="min-w-0 flex-1 truncate font-mono" aria-label={t('Element path')}>
          {htmlMode ? 'html' : elementPath(editor)}
        </span>
        <span aria-live="polite">{words === 1 ? t('1 word') : t('{n} words', { n: words })}</span>
        <Menu id="shortcuts" menu={menu} setMenu={setMenu} title={t('Keyboard shortcuts')} label="⌨" align="right" up>
          <table className="text-xs">
            <tbody>
              {SHORTCUTS.map(([keys, what]) => (
                <tr key={keys}>
                  <td className="whitespace-nowrap py-0.5 pr-4 font-mono">{keys}</td>
                  <td className="py-0.5">{t(what)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Menu>
        <button
          type="button"
          onClick={toggleHtml}
          aria-pressed={htmlMode}
          title={htmlMode ? t('Back to the rich text editor') : t('Edit the HTML')}
          className={`rounded px-1.5 py-0.5 font-mono hover:bg-neutral-100 dark:hover:bg-neutral-800 ${htmlMode ? 'bg-neutral-200 dark:bg-neutral-700' : ''}`}
        >
          {'</>'}
        </button>
      </div>
    </div>
  );
}

// --- Toolbar ----------------------------------------------------------------------------------------------------

function Toolbar({
  editor,
  menu,
  setMenu,
  baseUrl,
  userId,
  upload,
}: {
  editor: Editor;
  menu: MenuId | null;
  setMenu: (m: MenuId | null) => void;
  baseUrl: string | null;
  userId: number | string | null;
  upload?: (file: File) => Promise<UploadedFile>;
}) {
  const chain = () => editor.chain().focus();
  const block = editor.isActive('heading', { level: 2 })
    ? 'h2'
    : editor.isActive('heading', { level: 3 })
      ? 'h3'
      : editor.isActive('heading', { level: 4 })
        ? 'h4'
        : editor.isActive('codeBlock')
          ? 'pre'
          : 'p';
  const blockNames: Record<string, string> = { p: 'Paragraph', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', pre: 'Preformatted' };
  const setBlock = (b: string) => {
    if (b === 'p') chain().setParagraph().run();
    else if (b === 'pre') chain().setCodeBlock().run();
    else chain().setHeading({ level: Number(b.slice(1)) as 2 | 3 | 4 }).run();
    setMenu(null);
  };
  const fontSize = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? '12pt';
  const align = (['center', 'right', 'justify'] as const).find((a) => editor.isActive({ textAlign: a })) ?? 'left';
  const alignIcon = { left: '⇤', center: '↔', right: '⇥', justify: '☰' }[align];

  const setList = (kind: 'bulletList' | 'orderedList', style: string | null) => {
    const c = chain();
    if (!editor.isActive(kind)) (kind === 'bulletList' ? c.toggleBulletList() : c.toggleOrderedList());
    c.updateAttributes(kind, { listStyleType: style }).run();
    setMenu(null);
  };
  const setDir = (dir: 'ltr' | 'rtl') => {
    const c = chain();
    for (const type of BLOCK_TYPES) c.updateAttributes(type, { dir: dir === 'ltr' ? null : 'rtl' });
    c.run();
  };

  return (
    <div role="toolbar" aria-label={t('Text formatting')} className="flex shrink-0 flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-800 dark:bg-neutral-900">
      <Menu id="block" menu={menu} setMenu={setMenu} title={t('Blocks')} label={<span className="inline-block w-24 text-left">{t(blockNames[block])} ▾</span>}>
        {Object.entries(blockNames).map(([b, name]) => (
          <MenuItem key={b} active={b === block} onClick={() => setBlock(b)}>
            <span className={b === 'p' ? '' : b === 'pre' ? 'font-mono' : `font-semibold ${b === 'h2' ? 'text-lg' : b === 'h3' ? 'text-base' : ''}`}>{t(name)}</span>
          </MenuItem>
        ))}
      </Menu>
      <Menu id="size" menu={menu} setMenu={setMenu} title={t('Font size')} label={<span className="inline-block w-12 text-left">{fontSize} ▾</span>}>
        {FONT_SIZES.map((size) => (
          <MenuItem
            key={size}
            active={size === fontSize}
            onClick={() => {
              (size === '12pt' ? chain().unsetFontSize() : chain().setFontSize(size)).run();
              setMenu(null);
            }}
          >
            {size}
          </MenuItem>
        ))}
      </Menu>
      <Sep />
      <Btn title={`${t('Bold')} (${mod}+B)`} active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn title={`${t('Italic')} (${mod}+I)`} active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}>
        <i className="font-serif">I</i>
      </Btn>
      <Btn title={`${t('Underline')} (${mod}+U)`} active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
      <Btn title={t('Strikethrough')} active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}>
        <s>S</s>
      </Btn>
      <ColorMenu id="color" menu={menu} setMenu={setMenu} title={t('Text color')} current={editor.getAttributes('textStyle').color} onPick={(c) => (c ? chain().setColor(c) : chain().unsetColor()).run()}>
        <span className="font-semibold">A</span>
      </ColorMenu>
      <ColorMenu
        id="highlight"
        menu={menu}
        setMenu={setMenu}
        title={t('Background color')}
        current={editor.getAttributes('textStyle').backgroundColor}
        onPick={(c) => (c ? chain().setBackgroundColor(c) : chain().unsetBackgroundColor()).run()}
      >
        <span className="rounded-sm bg-yellow-200 px-0.5 font-semibold text-neutral-900">A</span>
      </ColorMenu>
      <Btn title={t('Superscript')} active={editor.isActive('superscript')} onClick={() => chain().toggleSuperscript().run()}>
        x<sup>2</sup>
      </Btn>
      <Btn title={t('Subscript')} active={editor.isActive('subscript')} onClick={() => chain().toggleSubscript().run()}>
        x<sub>2</sub>
      </Btn>
      <Btn title={t('Code')} active={editor.isActive('code')} onClick={() => chain().toggleCode().run()}>
        <span className="font-mono text-xs">{'<>'}</span>
      </Btn>
      <Sep />
      <LinkMenu editor={editor} menu={menu} setMenu={setMenu} />
      <ImageMenu editor={editor} menu={menu} setMenu={setMenu} baseUrl={baseUrl} userId={userId} upload={upload} />
      {upload && <DocumentMenu editor={editor} menu={menu} setMenu={setMenu} baseUrl={baseUrl} userId={userId} upload={upload} />}
      {baseUrl && <EquationMenu editor={editor} menu={menu} setMenu={setMenu} baseUrl={baseUrl} />}
      <Sep />
      <Menu id="align" menu={menu} setMenu={setMenu} title={t('Align')} label={`${alignIcon} ▾`}>
        {(
          [
            ['left', '⇤', 'Align left'],
            ['center', '↔', 'Align center'],
            ['right', '⇥', 'Align right'],
            ['justify', '☰', 'Justify'],
          ] as const
        ).map(([a, icon, name]) => (
          <MenuItem
            key={a}
            active={a === align}
            onClick={() => {
              (a === 'left' ? chain().unsetTextAlign() : chain().setTextAlign(a)).run();
              setMenu(null);
            }}
          >
            <span className="mr-2 inline-block w-4 text-center">{icon}</span>
            {t(name)}
          </MenuItem>
        ))}
      </Menu>
      <SplitMenu
        id="bullets"
        menu={menu}
        setMenu={setMenu}
        title={t('Bulleted list')}
        active={editor.isActive('bulletList')}
        onMain={() => chain().toggleBulletList().run()}
        main="•≡"
      >
        {BULLET_STYLES.map(([style, name]) => (
          <MenuItem key={name} active={editor.isActive('bulletList') && (editor.getAttributes('bulletList').listStyleType ?? null) === style} onClick={() => setList('bulletList', style)}>
            {t(name)}
          </MenuItem>
        ))}
      </SplitMenu>
      <SplitMenu
        id="numbers"
        menu={menu}
        setMenu={setMenu}
        title={t('Numbered list')}
        active={editor.isActive('orderedList')}
        onMain={() => chain().toggleOrderedList().run()}
        main="1≡"
      >
        {NUMBER_STYLES.map(([style, name]) => (
          <MenuItem key={name} active={editor.isActive('orderedList') && (editor.getAttributes('orderedList').listStyleType ?? null) === style} onClick={() => setList('orderedList', style)}>
            {t(name)}
          </MenuItem>
        ))}
      </SplitMenu>
      <Btn title={t('Decrease indent')} onClick={() => changeIndent(editor, -1)}>
        ⇠
      </Btn>
      <Btn title={t('Increase indent')} onClick={() => changeIndent(editor, 1)}>
        ⇢
      </Btn>
      <Btn title={t('Left-to-right')} active={!isRtl(editor)} onClick={() => setDir('ltr')}>
        <span className="text-xs">LTR</span>
      </Btn>
      <Btn title={t('Right-to-left')} active={isRtl(editor)} onClick={() => setDir('rtl')}>
        <span className="text-xs">RTL</span>
      </Btn>
      <Sep />
      <Btn title={t('Quote')} active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}>
        “ ”
      </Btn>
      <TableMenu editor={editor} menu={menu} setMenu={setMenu} />
      <Btn title={t('Horizontal line')} onClick={() => chain().setHorizontalRule().run()}>
        ―
      </Btn>
      <Btn title={t('Clear formatting')} onClick={() => chain().unsetAllMarks().clearNodes().run()}>
        <span className="text-xs">T<sub>×</sub></span>
      </Btn>
      <Sep />
      <Btn title={`${t('Undo')} (${mod}+Z)`} disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>
        ↶
      </Btn>
      <Btn title={`${t('Redo')} (${mod}+Shift+Z)`} disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>
        ↷
      </Btn>
    </div>
  );
}

/** Shown while the cursor is in a table: rows, columns, the header row, and removing it. */
function TableBar({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus();
  const items: [string, () => boolean][] = [
    ['Row above', () => chain().addRowBefore().run()],
    ['Row below', () => chain().addRowAfter().run()],
    ['Delete row', () => chain().deleteRow().run()],
    ['Column left', () => chain().addColumnBefore().run()],
    ['Column right', () => chain().addColumnAfter().run()],
    ['Delete column', () => chain().deleteColumn().run()],
    ['Header row', () => chain().toggleHeaderRow().run()],
    ['Merge or split cells', () => chain().mergeOrSplit().run()],
    ['Delete table', () => chain().deleteTable().run()],
  ];
  return (
    <div role="toolbar" aria-label={t('Table')} className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-200 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <span className="mr-1 font-medium text-neutral-500 dark:text-neutral-400">{t('Table')}:</span>
      {items.map(([name, run]) => (
        <button key={name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={run} className="rounded px-1.5 py-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-700">
          {t(name)}
        </button>
      ))}
    </div>
  );
}

// --- Menus with forms -------------------------------------------------------------------------------------------

type MenuProps = { editor: Editor; menu: MenuId | null; setMenu: (m: MenuId | null) => void };

function LinkMenu({ editor, menu, setMenu }: MenuProps) {
  const [href, setHref] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const open = menu === 'link';
  const empty = editor.state.selection.empty;
  useEffect(() => {
    if (!open) return;
    setHref((editor.getAttributes('link').href as string | undefined) ?? '');
    setText('');
    setError('');
  }, [open, editor]);
  const apply = () => {
    let url = href.trim();
    if (!url) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    if (!/^(https?:|mailto:)/i.test(url)) {
      setError(t('Links must start with https://, http:// or mailto:'));
      return;
    }
    const c = editor.chain().focus();
    if (editor.isActive('link')) c.extendMarkRange('link').setLink({ href: url }).run();
    else if (empty) c.insertContent({ type: 'text', text: text.trim() || url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    else c.setLink({ href: url }).run();
    setMenu(null);
  };
  return (
    <Menu id="link" menu={menu} setMenu={setMenu} title={`${t('Link')} (${mod}+K)`} label={<UiIcon name="link" />} active={editor.isActive('link')} panel>
      <Form onSubmit={apply}>
        {empty && !editor.isActive('link') && <Field label={t('Text')} value={text} onChange={setText} />}
        <Field label={t('Address')} value={href} onChange={setHref} placeholder="https://…" autoFocus />
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <PrimaryButton>{editor.isActive('link') ? t('Update link') : t('Add link')}</PrimaryButton>
          {editor.isActive('link') && (
            <SecondaryButton
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setMenu(null);
              }}
            >
              {t('Remove link')}
            </SecondaryButton>
          )}
        </div>
      </Form>
    </Menu>
  );
}

type UploadMenuProps = MenuProps & { baseUrl: string | null; userId: number | string | null; upload?: (file: File) => Promise<UploadedFile> };

/** The address an uploaded file is embedded or linked at, as Canvas's editor writes it (the verifier lets anyone open it). */
function fileAddress(baseUrl: string | null, userId: number | string | null, file: UploadedFile, preview: boolean): string {
  if (baseUrl && userId != null && file.uuid) {
    return `${baseUrl.replace(/\/+$/, '')}/users/${userId}/files/${file.id}${preview ? '/preview' : ''}?verifier=${encodeURIComponent(file.uuid)}${preview ? '' : '&wrap=1'}`;
  }
  return file.url ?? '';
}

function ImageMenu({ editor, menu, setMenu, baseUrl, userId, upload }: UploadMenuProps) {
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [decorative, setDecorative] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = menu === 'image';
  useEffect(() => {
    if (!open) return;
    setSrc('');
    setAlt('');
    setDecorative(false);
    setFile(null);
    setError('');
  }, [open]);
  const apply = async () => {
    setError('');
    if (!decorative && !alt.trim()) {
      setError(t('Describe the image for people who cannot see it, or mark it decorative.'));
      return;
    }
    let address = src.trim();
    if (file && upload) {
      setBusy(true);
      try {
        address = fileAddress(baseUrl, userId, await upload(file), true);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('Upload failed'));
        return;
      } finally {
        setBusy(false);
      }
    }
    if (!/^https?:\/\//i.test(address)) {
      setError(t('Choose an image, or give an address starting with https://'));
      return;
    }
    editor.chain().focus().setImage({ src: address, alt: decorative ? '' : alt.trim() }).run();
    setMenu(null);
  };
  return (
    <Menu id="image" menu={menu} setMenu={setMenu} title={t('Image')} label={<UiIcon name="image" />} panel>
      <Form onSubmit={apply}>
        {upload && (
          <label className="block text-xs">
            <span className="mb-1 block text-neutral-500 dark:text-neutral-400">{t('Upload an image')}</span>
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs" />
          </label>
        )}
        {!file && <Field label={upload ? t('…or its address') : t('Address')} value={src} onChange={setSrc} placeholder="https://…" />}
        <Field label={t('Alt text')} value={alt} onChange={setAlt} disabled={decorative} />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={decorative} onChange={(e) => setDecorative(e.target.checked)} />
          {t('Decorative image (no alt text)')}
        </label>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <PrimaryButton disabled={busy}>{busy ? t('Uploading…') : t('Insert image')}</PrimaryButton>
      </Form>
    </Menu>
  );
}

function DocumentMenu({ editor, menu, setMenu, baseUrl, userId, upload }: UploadMenuProps) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = menu === 'document';
  useEffect(() => {
    if (open) {
      setFile(null);
      setError('');
    }
  }, [open]);
  const apply = async () => {
    if (!file || !upload) return;
    setBusy(true);
    setError('');
    try {
      const uploaded = await upload(file);
      const href = fileAddress(baseUrl, userId, uploaded, false);
      const name = uploaded.display_name ?? file.name;
      editor.chain().focus().insertContent({ type: 'text', text: name, marks: [{ type: 'link', attrs: { href } }] }).insertContent(' ').run();
      setMenu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Upload failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Menu id="document" menu={menu} setMenu={setMenu} title={t('Document')} label={<UiIcon name="fileText" />} panel>
      <Form onSubmit={apply}>
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-500 dark:text-neutral-400">{t('Upload a document to link to')}</span>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs" />
        </label>
        {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
        <PrimaryButton disabled={busy || !file}>{busy ? t('Uploading…') : t('Insert link')}</PrimaryButton>
      </Form>
    </Menu>
  );
}

function EquationMenu({ editor, menu, setMenu, baseUrl }: MenuProps & { baseUrl: string }) {
  const [latex, setLatex] = useState('');
  const [preview, setPreview] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const open = menu === 'equation';
  // An equation that is selected opens for editing.
  const selected = editor.isActive('image') ? ((editor.getAttributes('image')['data-equation-content'] as string | null) ?? null) : null;
  useEffect(() => {
    if (open) setLatex(selected ?? '');
  }, [open, selected]);
  // Canvas draws the preview; wait for a pause in typing.
  useEffect(() => {
    const timer = setTimeout(() => setPreview(latex.trim()), 400);
    return () => clearTimeout(timer);
  }, [latex]);
  const insert = (snippet: string) => {
    const el = box.current;
    const at = el?.selectionStart ?? latex.length;
    const end = el?.selectionEnd ?? at;
    setLatex(latex.slice(0, at) + snippet + latex.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + snippet.length, at + snippet.length);
    });
  };
  const apply = () => {
    if (!latex.trim()) return;
    editor.chain().focus().insertContent(equationImageHtml(latex.trim(), baseUrl)).run();
    setMenu(null);
  };
  return (
    <Menu id="equation" menu={menu} setMenu={setMenu} title={t('Equation')} label={<span className="font-serif italic">√x</span>} active={!!selected} panel wide>
      <Form onSubmit={apply}>
        <div className="flex flex-wrap gap-1">
          {EQUATION_SNIPPETS.map((s) => (
            <button key={s} type="button" onClick={() => insert(s)} className="rounded border border-neutral-300 px-1.5 py-0.5 font-mono text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
              {s}
            </button>
          ))}
        </div>
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-500 dark:text-neutral-400">{t('LaTeX')}</span>
          <textarea
            ref={box}
            autoFocus
            rows={3}
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>
        <div className="flex min-h-12 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white p-2 dark:border-neutral-700">
          {preview ? (
            <img src={`${baseUrl.replace(/\/+$/, '')}/equation_images/${encodeURIComponent(encodeURIComponent(preview))}?scale=1`} alt={preview} className="max-w-full" />
          ) : (
            <span className="text-xs text-neutral-400">{t('Preview')}</span>
          )}
        </div>
        <PrimaryButton disabled={!latex.trim()}>{selected ? t('Update equation') : t('Insert equation')}</PrimaryButton>
      </Form>
    </Menu>
  );
}

function TableMenu({ editor, menu, setMenu }: MenuProps) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [header, setHeader] = useState(true);
  return (
    <Menu id="table" menu={menu} setMenu={setMenu} title={t('Table')} label={<UiIcon name="table" />} active={editor.isActive('table')} panel>
      <Form
        onSubmit={() => {
          editor.chain().focus().insertTable({ rows, cols, withHeaderRow: header }).run();
          setMenu(null);
        }}
      >
        <div className="flex gap-2">
          <NumberInput label={t('Rows')} value={rows} onChange={setRows} />
          <NumberInput label={t('Columns')} value={cols} onChange={setCols} />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} />
          {t('Header row')}
        </label>
        <PrimaryButton>{t('Insert table')}</PrimaryButton>
      </Form>
    </Menu>
  );
}

// --- Small parts ------------------------------------------------------------------------------------------------

const btnClass = (active?: boolean) =>
  `inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-neutral-700 ${
    active ? 'bg-neutral-200 text-accent-700 dark:bg-neutral-700 dark:text-accent-300' : ''
  }`;

function Btn({ title, active, disabled, onClick, children }: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // mousedown would move focus (and the selection) out of the editor before the click fires.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={btnClass(active)}
    >
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px bg-neutral-300 dark:bg-neutral-700" />;

/**
 * A toolbar button that opens a dropdown. One open at a time; a click outside or Escape closes it (Escape stops there,
 * so it does not also close the editor). `panel` dropdowns hold a form.
 */
function Menu({
  id,
  menu,
  setMenu,
  title,
  label,
  active,
  panel,
  wide,
  align = 'left',
  up,
  children,
}: {
  id: MenuId;
  menu: MenuId | null;
  setMenu: (m: MenuId | null) => void;
  title: string;
  label: ReactNode;
  active?: boolean;
  panel?: boolean;
  wide?: boolean;
  align?: 'left' | 'right';
  up?: boolean;
  children: ReactNode;
}) {
  const open = menu === id;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open, setMenu]);
  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setMenu(null);
        }
      }}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(e) => !panel && e.preventDefault()}
        onClick={() => setMenu(open ? null : id)}
        className={btnClass(active || open)}
      >
        {label}
      </button>
      {open && (
        <div
          role={panel ? 'dialog' : 'menu'}
          aria-label={title}
          className={`absolute z-20 rounded-md border border-neutral-200 bg-white text-sm text-neutral-900 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 ${
            up ? 'bottom-full mb-1' : 'top-full mt-1'
          } ${align === 'right' ? 'right-0' : 'left-0'} ${panel ? `${wide ? 'w-96' : 'w-72'} max-w-[85vw] p-3` : 'min-w-36 py-1'}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={!!active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`block w-full px-3 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 ${active ? 'text-accent-700 dark:text-accent-300' : ''}`}
    >
      {children}
    </button>
  );
}

/** A list button: the main part toggles the list, the arrow picks the marker style. */
function SplitMenu({ id, menu, setMenu, title, active, onMain, main, children }: { id: MenuId; menu: MenuId | null; setMenu: (m: MenuId | null) => void; title: string; active: boolean; onMain: () => void; main: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center">
      <Btn title={title} active={active} onClick={onMain}>
        <span className="text-xs">{main}</span>
      </Btn>
      <Menu id={id} menu={menu} setMenu={setMenu} title={`${title}: ${t('style')}`} label={<span className="text-[10px]">▾</span>}>
        {children}
      </Menu>
    </span>
  );
}

function ColorMenu({ id, menu, setMenu, title, current, onPick, children }: { id: MenuId; menu: MenuId | null; setMenu: (m: MenuId | null) => void; title: string; current?: string; onPick: (color: string | null) => void; children: ReactNode }) {
  const pick = (c: string | null) => {
    onPick(c);
    setMenu(null);
  };
  return (
    <Menu id={id} menu={menu} setMenu={setMenu} title={title} label={<span className="border-b-[3px] px-0.5 leading-tight" style={{ borderColor: current ?? 'transparent' }}>{children}</span>} panel>
      <div className="grid grid-cols-6 gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={c}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(c)}
            className={`h-7 w-7 rounded border ${current === c ? 'ring-2 ring-accent-500' : 'border-neutral-300 dark:border-neutral-600'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <label className="flex items-center gap-2">
          {t('Custom')}
          <input type="color" value={current && /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000'} onChange={(e) => onPick(e.target.value)} className="h-7 w-10 cursor-pointer" />
        </label>
        <button type="button" onClick={() => pick(null)} className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          {t('Remove color')}
        </button>
      </div>
    </Menu>
  );
}

function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  // Not a <form>: the editor sits inside the submission form, and forms cannot nest.
  return (
    <div
      className="space-y-2.5"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          onSubmit();
        }
      }}
    >
      {/* The primary button submits through this context. */}
      <FormContext.Provider value={onSubmit}>{children}</FormContext.Provider>
    </div>
  );
}

const FormContext = createContext<() => void>(() => {});

function PrimaryButton({ disabled, children }: { disabled?: boolean; children: ReactNode }) {
  const submit = useContext(FormContext);
  return (
    <button type="button" disabled={disabled} onClick={submit} className="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-700 disabled:opacity-50">
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
      {children}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, autoFocus, disabled }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; disabled?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block text-neutral-500 dark:text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950"
      />
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block flex-1 text-xs">
      <span className="mb-1 block text-neutral-500 dark:text-neutral-400">{label}</span>
      <input
        type="number"
        min={1}
        max={20}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
    </label>
  );
}

// --- Helpers ----------------------------------------------------------------------------------------------------

/** Indent: list items nest (as Tab does); paragraphs and headings get 40px more padding per step, as in Canvas. */
function changeIndent(editor: Editor, delta: 1 | -1) {
  if (editor.isActive('listItem')) {
    if (delta > 0) editor.chain().focus().sinkListItem('listItem').run();
    else editor.chain().focus().liftListItem('listItem').run();
    return;
  }
  const { state } = editor;
  const tr = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true;
    const indent = Math.max(0, Math.min(MAX_INDENT, (Number(node.attrs.indent) || 0) + delta));
    if (indent !== node.attrs.indent) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
  editor.commands.focus();
}

function isRtl(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).attrs.dir === 'rtl') return true;
  return false;
}

const NODE_TAGS: Record<string, string> = {
  paragraph: 'p', bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote', codeBlock: 'pre',
  table: 'table', tableRow: 'tr', tableCell: 'td', tableHeader: 'th', image: 'img', horizontalRule: 'hr',
};
const MARK_TAGS: Record<string, string> = {
  bold: 'strong', italic: 'em', underline: 'u', strike: 's', link: 'a', superscript: 'sup', subscript: 'sub', code: 'code', textStyle: 'span',
};

/** Where the cursor is, as Canvas's status bar shows it: "p » strong", "ul » li » p". */
export function elementPath(editor: Editor): string {
  const { $from } = editor.state.selection;
  const parts: string[] = [];
  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    parts.push(node.type.name === 'heading' ? `h${node.attrs.level}` : (NODE_TAGS[node.type.name] ?? node.type.name));
  }
  const selected = 'node' in editor.state.selection ? (editor.state.selection as { node?: { type: { name: string } } }).node : undefined;
  if (selected) parts.push(NODE_TAGS[selected.type.name] ?? selected.type.name);
  for (const mark of $from.marks()) parts.push(MARK_TAGS[mark.type.name] ?? mark.type.name);
  return parts.join(' » ');
}

/** The HTML with each block on its own line, for the HTML view. */
function prettyHtml(html: string): string {
  return html.replace(/(<\/(?:p|h[2-4]|li|ul|ol|blockquote|pre|tr|table|thead|tbody)>|<hr>|<br>)/g, '$1\n').replace(/(<(?:ul|ol|table|thead|tbody|tr)(?:\s[^>]*)?>)/g, '$1\n').trim();
}

function htmlToText(html: string): string {
  const probe = document.createElement('div');
  probe.innerHTML = cleanEditorHtml(html);
  return probe.textContent ?? '';
}

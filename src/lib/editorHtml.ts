import DOMPurify from 'dompurify';

// The HTML a text-entry submission may carry: what the editor (components/RichTextEditor.tsx) can produce, which is
// what Canvas's own Rich Content Editor produces. Everything goes through cleanEditorHtml() before it is sent, saved as
// a draft or shown.

const ALLOWED_TAGS = [
  'p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sup', 'sub', 'code', 'pre',
  'h2', 'h3', 'h4', 'blockquote', 'hr', 'ul', 'ol', 'li', 'a', 'img',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'title', 'alt', 'src', 'width', 'height', 'class', 'dir', 'style', 'colspan', 'rowspan', 'data-equation-content'];

/** Inline styles the editor writes: text and highlight color, font size, alignment, indentation, list markers. */
const ALLOWED_STYLES = ['color', 'background-color', 'font-size', 'text-align', 'padding-left', 'list-style-type'];
/** Classes Canvas gives meaning to: an equation (LaTeX in an image) and an uploaded file's link. */
const ALLOWED_CLASSES = ['equation_image', 'instructure_file_link'];

/** Values a style may not hold (anything that loads or runs something). */
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|javascript:|@import|[<>]/i;

export function cleanEditorHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, RETURN_DOM_FRAGMENT: true });
  for (const el of fragment.querySelectorAll<HTMLElement>('[style]')) {
    const kept: string[] = [];
    for (const prop of ALLOWED_STYLES) {
      const value = el.style.getPropertyValue(prop).trim();
      if (value && !UNSAFE_STYLE_VALUE.test(value)) kept.push(`${prop}: ${value}`);
    }
    if (kept.length) el.setAttribute('style', kept.join('; '));
    else el.removeAttribute('style');
  }
  for (const el of fragment.querySelectorAll('[class]')) {
    const kept = [...el.classList].filter((c) => ALLOWED_CLASSES.includes(c));
    if (kept.length) el.setAttribute('class', kept.join(' '));
    else el.removeAttribute('class');
  }
  for (const el of fragment.querySelectorAll('[dir]')) {
    if (!['ltr', 'rtl'].includes(el.getAttribute('dir') ?? '')) el.removeAttribute('dir');
  }
  for (const el of fragment.querySelectorAll('[target]')) {
    if (el.getAttribute('target') !== '_blank') el.removeAttribute('target');
  }
  const box = document.createElement('div');
  box.appendChild(fragment);
  return box.innerHTML.trim();
}

/** True when there is nothing a reader would see: tags with no text are empty, unless they are an image, rule or table. */
export function isEditorEmpty(html: string): boolean {
  const probe = document.createElement('div');
  probe.innerHTML = cleanEditorHtml(html);
  return probe.textContent?.trim() === '' && !probe.querySelector('img, hr, table');
}

/**
 * Canvas's address for an equation: it draws the LaTeX as an image. Its own editor encodes the LaTeX twice, and the
 * submission keeps the LaTeX in `data-equation-content` so it can be edited again.
 */
export function equationImageHtml(latex: string, baseUrl: string): string {
  const src = `${baseUrl.replace(/\/+$/, '')}/equation_images/${encodeURIComponent(encodeURIComponent(latex))}?scale=1`;
  const img = document.createElement('img');
  img.className = 'equation_image';
  img.setAttribute('src', src);
  img.setAttribute('alt', `LaTeX: ${latex}`);
  img.setAttribute('title', latex);
  img.setAttribute('data-equation-content', latex);
  return img.outerHTML;
}

/** Words as Canvas's editor counts them: runs of letters, digits and apostrophes. */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}'’]+/gu)?.length ?? 0;
}

// --- Drafts ------------------------------------------------------------------------------------------------------
// Like Canvas's editor, unsent text is kept in this browser until it is submitted.

const draftKey = (courseId: number, assignmentId: number) => `courseline.draft.${courseId}.${assignmentId}`;

export function loadDraft(courseId: number, assignmentId: number): string {
  try {
    return localStorage.getItem(draftKey(courseId, assignmentId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(courseId: number, assignmentId: number, html: string): void {
  try {
    if (isEditorEmpty(html)) localStorage.removeItem(draftKey(courseId, assignmentId));
    else localStorage.setItem(draftKey(courseId, assignmentId), cleanEditorHtml(html));
  } catch {
    /* storage full or blocked: the draft just is not kept */
  }
}

// Canvas HTML (pages, assignment descriptions, the syllabus) → Markdown, for the AI export.
// DOMParser builds an inert document: scripts never run and images never load.

export interface MarkdownOptions {
  /** Rewrite a link's href (e.g. a Canvas file link to the exported copy). Return the new href. */
  rewriteHref?: (href: string) => string;
}

const SKIP = new Set(['script', 'style', 'noscript', 'head', 'template']);
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'main', 'aside', 'nav', 'details', 'summary', 'dl', 'dt', 'dd']);

/** `**text**` that keeps the spaces outside the marks (Markdown does not allow them inside). */
function wrap(mark: string, text: string): string {
  const core = text.trim();
  if (!core) return text;
  return `${/^\s/.test(text) ? ' ' : ''}${mark}${core}${mark}${/\s$/.test(text) ? ' ' : ''}`;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

function renderChildren(el: Node, o: MarkdownOptions): string {
  return Array.from(el.childNodes)
    .map((n) => render(n, o))
    .join('');
}

function list(el: Element, depth: number, o: MarkdownOptions): string {
  const ordered = el.tagName.toLowerCase() === 'ol';
  const start = Number(el.getAttribute('start')) || 1;
  const lines: string[] = [];
  let n = start;
  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const marker = ordered ? `${n++}.` : '-';
    let text = '';
    const nested: string[] = [];
    for (const child of Array.from(li.childNodes)) {
      const tag = child.nodeType === 1 ? (child as Element).tagName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') nested.push(list(child as Element, depth + 1, o));
      else text += render(child, o);
    }
    lines.push(`${'  '.repeat(depth)}${marker} ${oneLine(text)}`);
    for (const block of nested) lines.push(block);
  }
  return lines.join('\n');
}

function table(el: Element, o: MarkdownOptions): string {
  const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children)
      .filter((c) => ['td', 'th'].includes(c.tagName.toLowerCase()))
      .map((c) => oneLine(renderChildren(c, o)).replace(/\|/g, '\\|')),
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length === 0 || width === 0) return '';
  const pad = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
  const [head, ...body] = rows;
  return `\n\n${[pad(head), pad(Array(width).fill('---')), ...body.map(pad)].join('\n')}\n\n`;
}

function render(node: Node, o: MarkdownOptions): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag)) return '';

  if (/^h[1-6]$/.test(tag)) {
    const text = oneLine(renderChildren(el, o));
    return text ? `\n\n${'#'.repeat(Number(tag[1]))} ${text}\n\n` : '';
  }
  if (BLOCKS.has(tag)) return `\n\n${renderChildren(el, o).trim()}\n\n`;

  switch (tag) {
    case 'br':
      return '  \n';
    case 'hr':
      return '\n\n---\n\n';
    case 'strong':
    case 'b':
      return wrap('**', renderChildren(el, o));
    case 'em':
    case 'i':
      return wrap('*', renderChildren(el, o));
    case 'code':
      return el.parentElement?.tagName.toLowerCase() === 'pre' ? (el.textContent ?? '') : wrap('`', el.textContent ?? '');
    case 'pre':
      return `\n\n\`\`\`\n${(el.textContent ?? '').replace(/\n+$/, '')}\n\`\`\`\n\n`;
    case 'blockquote':
      return `\n\n${renderChildren(el, o)
        .trim()
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n')}\n\n`;
    case 'ul':
    case 'ol':
      return `\n\n${list(el, 0, o)}\n\n`;
    case 'table':
      return table(el, o);
    case 'a': {
      const text = oneLine(renderChildren(el, o));
      const href = el.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return text;
      if (!text) return '';
      return `[${text}](${o.rewriteHref ? o.rewriteHref(href) : href})`;
    }
    case 'img': {
      // Canvas renders equations as images whose LaTeX is kept in data-equation-content.
      const latex = el.getAttribute('data-equation-content');
      if (latex) return `$${latex}$`;
      const alt = el.getAttribute('alt')?.trim();
      return alt ? `[Image: ${alt}]` : '';
    }
    case 'iframe':
    case 'video':
    case 'audio': {
      const src = el.getAttribute('src') ?? el.querySelector('source')?.getAttribute('src');
      const title = el.getAttribute('title') ?? '';
      return src ? `\n\n[Embedded ${tag === 'iframe' ? 'content' : tag}${title ? `: ${title}` : ''}](${src})\n\n` : '';
    }
    default:
      return renderChildren(el, o);
  }
}

export function htmlToMarkdown(html: string | null | undefined, options: MarkdownOptions = {}): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return render(doc.body, options)
    .split(/(```[\s\S]*?```)/) // odd parts are code blocks: leave their spacing alone
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/(\S) {2,}(?=\S)/g, '$1 ') // bold/italic wrappers can double up spaces
            .replace(/[ \t]+\n/g, (m) => (m.startsWith('  ') ? '  \n' : '\n')), // keep deliberate line breaks
    )
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

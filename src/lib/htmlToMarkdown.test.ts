import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './htmlToMarkdown';

describe('htmlToMarkdown', () => {
  it('converts headings, paragraphs and inline formatting', () => {
    expect(htmlToMarkdown('<h2>Cells</h2><p>The <b>cell</b> is the <i>basic</i> unit.</p>')).toBe('## Cells\n\nThe **cell** is the *basic* unit.');
  });

  it('keeps the spaces around bold text', () => {
    expect(htmlToMarkdown('<p>a <b> b </b> c</p>')).toBe('a **b** c');
  });

  it('converts nested lists, ordered and unordered', () => {
    const md = htmlToMarkdown('<ul><li>One<ul><li>Inner</li></ul></li><li>Two</li></ul><ol start="3"><li>Third</li></ol>');
    expect(md).toBe('- One\n  - Inner\n- Two\n\n3. Third');
  });

  it('converts links and can rewrite their addresses', () => {
    const html = '<p><a href="/courses/1/files/9">Slides</a> and <a href="#top">top</a></p>';
    expect(htmlToMarkdown(html)).toBe('[Slides](/courses/1/files/9) and top');
    expect(htmlToMarkdown(html, { rewriteHref: () => '../files/slides.pdf' })).toBe('[Slides](../files/slides.pdf) and top');
  });

  it('keeps equations (as LaTeX) and image descriptions', () => {
    const md = htmlToMarkdown('<p><img class="equation_image" data-equation-content="x^2+1" alt="x squared"> and <img alt="A diagram of a cell" src="/x.png"></p>');
    expect(md).toBe('$x^2+1$ and [Image: A diagram of a cell]');
  });

  it('converts tables, with the first row as the header', () => {
    const md = htmlToMarkdown('<table><tr><th>Term</th><th>Meaning</th></tr><tr><td>a|b</td><td>x</td></tr></table>');
    expect(md).toBe('| Term | Meaning |\n| --- | --- |\n| a\\|b | x |');
  });

  it('keeps code blocks and quotes, and links embedded videos', () => {
    const md = htmlToMarkdown('<pre><code>let x = 1;\n</code></pre><blockquote><p>Wise words</p></blockquote><iframe title="Lecture" src="https://youtu.be/abc"></iframe>');
    expect(md).toBe('```\nlet x = 1;\n```\n\n> Wise words\n\n[Embedded content: Lecture](https://youtu.be/abc)');
  });

  it('drops scripts and styles, and returns "" for nothing', () => {
    expect(htmlToMarkdown('<style>p{}</style><script>alert(1)</script><p>Hi</p>')).toBe('Hi');
    expect(htmlToMarkdown(null)).toBe('');
    expect(htmlToMarkdown('')).toBe('');
  });
});

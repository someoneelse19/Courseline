import { describe, expect, it } from 'vitest';
import { isCanvasFileLink, sanitize } from './HtmlContent';

const BASE = 'https://school.test';
const dom = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('sanitize: untrusted instructor HTML', () => {
  it('removes scripts, event handlers and javascript: links', () => {
    const out = sanitize('<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src="x" onerror="alert(1)">', BASE);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/onclick|onerror/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain('hi');
  });

  it('removes iframes and objects', () => {
    expect(sanitize('<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="x">', BASE).trim()).toBe('');
  });

  it('keeps ordinary formatting', () => {
    const root = dom(sanitize('<h2>T</h2><table><tr><td>cell</td></tr></table><ul><li>a</li></ul>', BASE));
    expect(root.querySelector('h2')).not.toBeNull();
    expect(root.querySelector('td')?.textContent).toBe('cell');
  });
});

describe('sanitize: links', () => {
  it('makes root-relative links and images absolute against Canvas', () => {
    const root = dom(sanitize('<a href="/courses/1/pages/intro">p</a><img src="/files/9/preview">', BASE));
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://school.test/courses/1/pages/intro');
    expect(root.querySelector('img')?.getAttribute('src')).toBe('https://school.test/files/9/preview');
  });

  it('opens normal links in a new tab without leaking the opener', () => {
    const a = dom(sanitize('<a href="https://example.com">x</a>', BASE)).querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('turns Canvas file links into inert links that cannot navigate or download', () => {
    const a = dom(sanitize('<a href="/courses/1/files/201/download?download_frd=1" download="x.pdf" target="_blank">Slides</a>', BASE)).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('#');
    expect(a.hasAttribute('download')).toBe(false);
    expect(a.hasAttribute('target')).toBe(false);
    expect(a.getAttribute('data-canvas-file')).toBe('https://school.test/courses/1/files/201/download?download_frd=1');
  });

  it('strips download attributes from every link', () => {
    expect(dom(sanitize('<a href="https://example.com/f.zip" download>z</a>', BASE)).querySelector('a')?.hasAttribute('download')).toBe(false);
  });
});

describe('isCanvasFileLink', () => {
  it('matches file links on the Canvas host only', () => {
    expect(isCanvasFileLink('https://school.test/courses/1/files/2', BASE)).toBe(true);
    expect(isCanvasFileLink('/files/2/download', BASE)).toBe(true);
    expect(isCanvasFileLink('https://other.test/files/2', BASE)).toBe(false);
    expect(isCanvasFileLink('https://school.test/courses/1/pages/files', BASE)).toBe(false);
    expect(isCanvasFileLink('https://school.test/files/2', null)).toBe(false);
  });
});

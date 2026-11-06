import { describe, expect, it } from 'vitest';
import { isCanvasFileLink, isVideoEmbed, sanitize } from './HtmlContent';

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

  it('keeps an embedded video player from a known host, sandboxed, and nothing else that looks like one', () => {
    // As Canvas's editor saves a Vimeo embed (Oct 31, 2026: a course's "Unit 1 introduction video" page).
    const vimeo =
      '<div style="padding: 56.25% 0 0 0; position: relative;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" title="Intro" src="https://player.vimeo.com/video/123456789?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479" allow="autoplay; fullscreen; camera; microphone" frameborder="0" onload="steal()"></iframe></div>';
    const frame = dom(sanitize(vimeo, BASE)).querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('https://player.vimeo.com/video/123456789?badge=0&autopause=0&player_id=0&app_id=58479');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('allow')).not.toMatch(/camera|microphone/); // only what a player needs
    expect(frame.hasAttribute('onload')).toBe(false);
    expect(frame.getAttribute('style')).toContain('position: absolute'); // the 16:9 layout survives
    const dropped = [
      '<iframe src="http://player.vimeo.com/video/1"></iframe>', // not https
      '<iframe src="https://player.vimeo.com.evil.test/video/1"></iframe>',
      '<iframe src="https://www.youtube.com/watch?v=abc"></iframe>', // a page, not the player
      '<iframe src="javascript:alert(1)"></iframe>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    ];
    for (const html of dropped) expect(dom(sanitize(html, BASE)).querySelector('iframe')).toBeNull();
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

describe('isVideoEmbed', () => {
  it('accepts Vimeo and YouTube players only', () => {
    expect(isVideoEmbed('https://player.vimeo.com/video/42?h=abc')).toBe(true);
    expect(isVideoEmbed('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
    expect(isVideoEmbed('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10')).toBe(true);
    expect(isVideoEmbed('https://vimeo.com/42')).toBe(false);
    expect(isVideoEmbed('https://user:pw@player.vimeo.com/video/42')).toBe(false);
    expect(isVideoEmbed(null)).toBe(false);
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

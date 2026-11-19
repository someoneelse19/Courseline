import { describe, expect, it } from 'vitest';
import { embedKind, isCanvasFileLink, sanitize } from './HtmlContent';

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

  it('removes objects, and shows an embed from an unknown host as a link to it, not a frame', () => {
    expect(sanitize('<object data="x"></object><embed src="x">', BASE).trim()).toBe('');
    const root = dom(sanitize('<iframe src="https://forms.example.test/f/1" title="Sign-up form" onload="x()"></iframe>', BASE));
    expect(root.querySelector('iframe')).toBeNull();
    const a = root.querySelector('a.canvas-embed')!;
    expect(a.getAttribute('href')).toBe('https://forms.example.test/f/1');
    expect(a.textContent).toBe('Sign-up form');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    // No title: says where it comes from. A Canvas-relative one points at Canvas.
    expect(dom(sanitize('<iframe src="/courses/1/external_tools/retrieve?url=x"></iframe>', BASE)).querySelector('a')?.textContent).toBe('Embedded content from school.test');
  });

  it('keeps an embedded LibGuides page, sandboxed, with a link to open it in a new tab', () => {
    // As a course page embeds its library guide (Nov 13, 2026).
    const guide =
      '<iframe style="width: 100%; height: 800px;" title="" src="https://lgapi-eu.libapps.com/widget_c.php?site_id=24840&amp;widget_type=9&amp;output_format=3&amp;widget_embed_type=1&amp;guide_id=728860&amp;enable_navigation=1&amp;content_type_id=1&amp;config_id=1771861828743" loading="lazy" allowfullscreen="allowfullscreen" allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *"></iframe>';
    const root = dom(sanitize(guide, BASE));
    const frame = root.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toContain('https://lgapi-eu.libapps.com/widget_c.php?site_id=24840');
    expect(frame.getAttribute('sandbox')).toContain('allow-forms');
    expect(frame.getAttribute('allow')).not.toMatch(/geolocation|camera|microphone/);
    expect(frame.getAttribute('style')).toContain('height: 800px');
    expect(root.querySelector('a.canvas-embed-open')?.getAttribute('href')).toBe(frame.getAttribute('src'));
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

describe('embedKind', () => {
  it('knows the Vimeo and YouTube players and LibGuides widgets, and nothing else', () => {
    expect(embedKind('https://player.vimeo.com/video/42?h=abc')).toBe('video');
    expect(embedKind('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('video');
    expect(embedKind('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10')).toBe('video');
    expect(embedKind('https://lgapi-eu.libapps.com/widget_c.php?site_id=1')).toBe('page');
    expect(embedKind('https://lgapi-us.libapps.com/widgets.php?site_id=1')).toBe('page');
    expect(embedKind('https://lgapi-eu.libapps.com/admin.php')).toBeNull();
    expect(embedKind('https://vimeo.com/42')).toBeNull();
    expect(embedKind('https://user:pw@player.vimeo.com/video/42')).toBeNull();
    expect(embedKind(null)).toBeNull();
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

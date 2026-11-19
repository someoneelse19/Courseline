import { afterEach, describe, expect, it } from 'vitest';
import { cleanEditorHtml, countWords, equationImageHtml, isEditorEmpty, loadDraft, saveDraft } from './editorHtml';

afterEach(() => localStorage.clear());

describe('cleanEditorHtml', () => {
  it('keeps the formatting Canvas’s editor writes', () => {
    const html =
      '<h2 dir="rtl" style="text-align: center">T</h2><p style="padding-left: 40px"><span style="color: #e03e2d; font-size: 18pt; background-color: #f1c40f">x</span><sup>2</sup><sub>i</sub><s>no</s><u>u</u></p>' +
      '<ol style="list-style-type: lower-roman"><li><p>a</p></li></ol><table><tbody><tr><th>h</th></tr><tr><td colspan="2">c</td></tr></tbody></table><hr><pre><code>x = 1</code></pre>';
    // Colors come back as the browser writes them (rgb), the styles in a fixed order.
    expect(cleanEditorHtml(html)).toBe(html.replace('color: #e03e2d; font-size: 18pt; background-color: #f1c40f', 'color: rgb(224, 62, 45); background-color: rgb(241, 196, 15); font-size: 18pt'));
  });

  it('drops styles it does not know, unsafe style values, and classes Canvas gives no meaning to', () => {
    const out = cleanEditorHtml('<p style="position: fixed; color: red; background-color: url(https://x.test/a.png)" class="evil equation_image">x</p>');
    expect(out).toBe('<p style="color: red" class="equation_image">x</p>');
  });

  it('removes scripts, handlers and javascript: links', () => {
    const out = cleanEditorHtml('<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)" target="_top">bad</a><iframe src="https://x.test"></iframe>');
    expect(out).not.toMatch(/script|onclick|javascript:|iframe|_top/);
  });
});

describe('isEditorEmpty', () => {
  it('is empty with only empty tags, not with an image, rule or table', () => {
    expect(isEditorEmpty('<p><br></p>')).toBe(true);
    expect(isEditorEmpty('<p><img src="https://x.test/a.png" alt=""></p>')).toBe(false);
    expect(isEditorEmpty('<hr>')).toBe(false);
  });
});

describe('equationImageHtml', () => {
  it('points at Canvas’s equation images, encoded twice as Canvas does, and keeps the LaTeX', () => {
    const probe = document.createElement('div');
    probe.innerHTML = equationImageHtml('\\frac{a}{b}', 'https://school.test/');
    const img = probe.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://school.test/equation_images/%255Cfrac%257Ba%257D%257Bb%257D?scale=1');
    expect(img.className).toBe('equation_image');
    expect(img.getAttribute('data-equation-content')).toBe('\\frac{a}{b}');
    expect(img.getAttribute('alt')).toBe('LaTeX: \\frac{a}{b}');
    expect(cleanEditorHtml(probe.innerHTML)).toBe(probe.innerHTML); // survives cleaning
  });
});

describe('countWords', () => {
  it('counts words in any language, apostrophes included', () => {
    expect(countWords("It's a año nuevo test, 42 times")).toBe(7);
    expect(countWords('   ')).toBe(0);
  });
});

describe('drafts', () => {
  it('keeps a draft per assignment, cleaned, and forgets an empty one', () => {
    saveDraft(1, 2, '<p onclick="x()">draft</p>');
    expect(loadDraft(1, 2)).toBe('<p>draft</p>');
    expect(loadDraft(1, 3)).toBe('');
    saveDraft(1, 2, '<p></p>');
    expect(localStorage.getItem('courseline.draft.1.2')).toBeNull();
  });
});

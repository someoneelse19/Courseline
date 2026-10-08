import { describe, expect, it } from 'vitest';
import { htmlText, linkedFiles } from './html';

describe('linkedFiles', () => {
  it('finds Canvas file links, named by their screen-reader label without the Download prefix', () => {
    const html = `
      <p>Read <a href="/courses/1/files/7?wrap=1">notes.pdf</a> first.</p>
      <a class="file_download_btn" href="/courses/1/files/8/download"><span class="screenreader-only">Download slides.pptx</span></a>
      <a href="/courses/1/files/9" aria-label="Descargar tarea.docx"></a>
      <a href="https://example.com/page">not a file</a>`;
    expect(linkedFiles(html)).toEqual([
      { id: '7', name: 'notes.pdf', url: '/courses/1/files/7?wrap=1' },
      { id: '8', name: 'slides.pptx', url: '/courses/1/files/8/download' },
      { id: '9', name: 'tarea.docx', url: '/courses/1/files/9' },
    ]);
  });

  it('lists a file once even when it is linked several times, and prefers data-id', () => {
    const html = '<a href="/files/5">a.pdf</a><a href="/files/5/download">a.pdf again</a><a data-id="6" href="/courses/1/files/x">b.pdf</a>';
    expect(linkedFiles(html).map((f) => [f.id, f.name])).toEqual([
      ['5', 'a.pdf'],
      ['6', 'b.pdf'],
    ]);
  });

  it('skips links with no readable name, and handles empty input', () => {
    expect(linkedFiles('<a href="/files/3"><img src="x.png"></a>')).toEqual([]);
    expect(linkedFiles('')).toEqual([]);
  });
});

describe('htmlText', () => {
  it('returns the text without running anything in it', () => {
    expect(htmlText('<p>Hello <b>there</b></p><script>window.ran = true</script>')).toBe('Hello therewindow.ran = true');
    expect((window as { ran?: boolean }).ran).toBeUndefined();
  });
});

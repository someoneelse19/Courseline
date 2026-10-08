import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { extractText } from './extractText';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const zipped = async (files: Record<string, string>) => {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'arraybuffer' });
};

describe('extractText', () => {
  it('reads plain text, converts HTML to Markdown and fences code', async () => {
    expect(await extractText(bytes('hello\n'), 'notes.txt')).toBe('hello');
    expect(await extractText(bytes('<h1>Title</h1><p>Body</p>'), 'page.html')).toBe('# Title\n\nBody');
    expect(await extractText(bytes('print(1)\n'), 'demo.py')).toBe('```py\nprint(1)\n```');
  });

  it('reads Word documents, keeping headings and lists', async () => {
    const w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<?xml version="1.0"?><w:document ${w}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Photosynthesis</w:t></w:r></w:p>
      <w:p><w:r><w:t>Plants make </w:t></w:r><w:r><w:t>sugar.</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Light</w:t></w:r></w:p>
    </w:body></w:document>`;
    const text = await extractText(await zipped({ 'word/document.xml': doc }), 'lecture.docx');
    expect(text).toBe('# Photosynthesis\n\nPlants make sugar.\n\n- Light');
  });

  it('reads PowerPoint slides in order, with speaker notes', async () => {
    const a = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const slide = (t: string) => `<p:sld ${a}><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
    const notes = `<p:notes ${a}><a:p><a:r><a:t>Say this aloud</a:t></a:r></a:p><a:p><a:fld type="slidenum"><a:t>1</a:t></a:fld></a:p></p:notes>`;
    const rels = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`;
    const text = await extractText(
      await zipped({
        'ppt/slides/slide2.xml': slide('Second'),
        'ppt/slides/slide1.xml': slide('First'),
        'ppt/slides/_rels/slide1.xml.rels': rels,
        'ppt/notesSlides/notesSlide1.xml': notes,
      }),
      'deck.pptx',
    );
    expect(text).toBe('## Slide 1\n\nFirst\n\n**Speaker notes:**\n\nSay this aloud\n\n## Slide 2\n\nSecond');
  });

  it('returns null for things with no text, and for damaged files', async () => {
    expect(await extractText(bytes(''), 'empty.txt')).toBeNull();
    expect(await extractText(bytes('x'), 'photo.png')).toBeNull();
    expect(await extractText(bytes('not a zip'), 'broken.docx')).toBeNull();
  });
});

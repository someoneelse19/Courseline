import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { drawDocxCharts } from './docxCharts';

const CHART = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Hours</c:v></c:tx><c:cat><c:strLit><c:ptCount val="2"/><c:pt idx="0"><c:v>Reading</c:v></c:pt><c:pt idx="1"><c:v>Writing</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>3</c:v></c:pt></c:numLit></c:val></c:ser></c:pieChart></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`;
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
const chartRun = (rid: string) =>
  `<w:r><w:drawing><wp:inline><wp:extent cx="4572000" cy="2743200"/><wp:docPr id="1" name="Chart 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

function docx(withChart = true): JSZip {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml', `<w:document ${NS}><w:body><w:p><w:r><w:t>Intro</w:t></w:r></w:p><w:p>${withChart ? chartRun('rId5') : ''}</w:p></w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>');
  zip.file('word/charts/chart1.xml', CHART);
  if (withChart) {
    zip.file('word/header1.xml', `<w:hdr ${NS}><w:p>${chartRun('rId1')}</w:p></w:hdr>`);
    zip.file('word/_rels/header1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>');
  }
  return zip;
}

describe('drawDocxCharts', () => {
  it('turns each chart (body and headers) into an SVG picture of the same size', async () => {
    const zip = docx();
    expect(await drawDocxCharts(zip)).toBe(2);

    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).not.toContain('<c:chart ');
    expect(doc).toContain('drawingml/2006/picture');
    const embed = doc.match(/embed="([^"]+)"/)?.[1];
    expect(doc).toMatch(/<a:ext cx="4572000" cy="2743200"\/>/);

    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    const target = rels.match(new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${embed}"`))?.[1];
    expect(target).toMatch(/^media\/.+\.svg$/);
    const svg = await zip.file(`word/${target}`)!.async('string');
    expect(svg).toContain('width="480"');
    expect(svg).toContain('>Reading<');

    expect(await zip.file('word/header1.xml')!.async('string')).toContain('drawingml/2006/picture');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="svg" ContentType="image/svg+xml"');
  });

  it('leaves a document without charts alone', async () => {
    const zip = docx(false);
    const before = await zip.file('word/document.xml')!.async('string');
    expect(await drawDocxCharts(zip)).toBe(0);
    expect(await zip.file('word/document.xml')!.async('string')).toBe(before);
    expect(await zip.file('[Content_Types].xml')!.async('string')).not.toContain('svg');
  });
});

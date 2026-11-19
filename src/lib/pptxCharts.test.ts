import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { replaceChartNodes, slideChartSvgs } from './pptxCharts';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (...items: [string, string, string][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const chartXml = (name: string) =>
  `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${name}</c:v></c:tx><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>3</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:crossAx val="1"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;
const frame = (rid: string) =>
  `<p:graphicFrame><p:xfrm><a:off x="0" y="0"/><a:ext cx="3810000" cy="1905000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
const NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

/** Slide 1 has no chart; slide 2 (listed first in the folder, second in the deck) has two. */
function deck(): JSZip {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels(['rId2', 'slide', 'slides/slide9.xml'], ['rId3', 'slide', 'slides/slide1.xml']));
  zip.file('ppt/slides/slide9.xml', `<p:sld ${NS}><p:cSld><p:spTree/></p:cSld></p:sld>`);
  zip.file('ppt/slides/slide1.xml', `<p:sld ${NS}><p:cSld><p:spTree>${frame('rId7')}<p:grpSp>${frame('rId8')}</p:grpSp></p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', rels(['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId7', 'chart', '../charts/chart1.xml'], ['rId8', 'chart', '../charts/chart2.xml']));
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels(['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']));
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels(['rId1', 'theme', '../theme/theme1.xml']));
  zip.file('ppt/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="123456"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
  zip.file('ppt/charts/chart1.xml', chartXml('First'));
  zip.file('ppt/charts/chart2.xml', chartXml('Second'));
  return zip;
}

describe('slideChartSvgs', () => {
  it('draws each slide\'s charts in deck order, at their size, with the slide\'s theme colors', async () => {
    const svgs = await slideChartSvgs(deck());
    expect(svgs.length).toBe(2);
    expect(svgs[0]).toEqual([]);
    expect(svgs[1].length).toBe(2);
    expect(svgs[1][0]).toContain('width="400" height="200"');
    expect(svgs[1][0]).toContain('>First<');
    expect(svgs[1][1]).toContain('>Second<');
    expect(svgs[1][0]).toContain('#123456');
  });
});

describe('replaceChartNodes', () => {
  it('swaps the library\'s chart boxes for pictures in the same place, a slide\'s own charts being its last boxes', () => {
    const slides = [0, 1].map(() => document.createElement('div'));
    // Slide 2: one box from its layout, then its two charts.
    slides[1].innerHTML = '<div class="chart-node" style="left: 1px;"></div><div class="chart-node" style="left: 10px; top: 20px; width: 300px;"></div><div class="chart-node" style="left: 50px;"></div>';
    const n = replaceChartNodes(slides, [[], ['<svg>a</svg>', null]], 'Chart');
    expect(n).toBe(1);
    const [layoutBox, picture, unreadable] = Array.from(slides[1].children) as HTMLElement[];
    expect(layoutBox.className).toBe('chart-node');
    expect(picture.tagName).toBe('IMG');
    expect(picture.getAttribute('alt')).toBe('Chart');
    expect(picture.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(picture.style.left).toBe('10px');
    expect(picture.style.width).toBe('300px');
    expect(unreadable.className).toBe('chart-node');
  });

  it('leaves a slide alone when it has fewer boxes than charts', () => {
    const slide = document.createElement('div');
    slide.innerHTML = '<div class="chart-node"></div>';
    expect(replaceChartNodes([slide], [['<svg/>', '<svg/>']], 'Chart')).toBe(0);
  });
});

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applyTint, colIndex, readWorkbookStyles } from './xlsxStyles';

/** Each of red, green and blue within 4 of the other color's. */
const near = (a: string, b: string) => [0, 2, 4].every((i) => Math.abs(parseInt(a.replace('#', '').slice(i, i + 2), 16) - parseInt(b.replace('#', '').slice(i, i + 2), 16)) <= 4);

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

async function workbook(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook ${NS}><sheets><sheet name="Grades" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>');
  zip.file('xl/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>');
  zip.file(
    'xl/styles.xml',
    `<styleSheet ${NS}>
      <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFC00000"/><name val="Arial"/></font></fonts>
      <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>
      <borders count="2"><border/><border><bottom style="medium"><color indexed="64"/></bottom></border></borders>
      <cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="2" borderId="1"><alignment horizontal="center" wrapText="1"/></xf><xf fontId="0" fillId="3" borderId="0"/></cellXfs>
    </styleSheet>`,
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet ${NS}><sheetViews><sheetView showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>
      <cols><col min="1" max="2" width="20" customWidth="1"/><col min="3" max="3" width="9" hidden="1"/></cols>
      <sheetData><row r="1" ht="24" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="2"><v>5</v></c></row><row r="2" hidden="1"><c r="A2"><v>1</v></c></row></sheetData></worksheet>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('readWorkbookStyles', () => {
  it('reads fills (theme colors with tint, plain colors), fonts, borders and alignment', async () => {
    const wb = await readWorkbookStyles(await workbook());
    expect(wb).not.toBeNull();
    const [plain, header, yellow] = wb!.xfs;
    expect(plain.bg).toBeUndefined();
    expect(near(header.bg!, '#D9E1F2')).toBe(true); // Excel's "Accent 1, lighter 80%"
    expect(header).toMatchObject({ bold: true, color: '#C00000', fontSizePt: 14, fontName: 'Arial', hAlign: 'center', wrap: true });
    expect(header.borders).toEqual({ bottom: '2px solid #000000' });
    expect(yellow.bg).toBe('#FFFF00');
  });

  it('reads each sheet\'s cell styles, widths, row heights, hidden rows and columns, and gridlines', async () => {
    const sheet = (await readWorkbookStyles(await workbook()))!.sheets.get('Grades')!;
    expect(sheet.cellStyle.get('A1')).toBe(1);
    expect(sheet.cellStyle.get('B1')).toBe(2);
    expect(sheet.cellStyle.has('A2')).toBe(false);
    expect(sheet.cols.get(0)?.widthPx).toBe(145);
    expect(sheet.cols.get(2)?.hidden).toBe(true);
    expect(sheet.rows.get(0)?.heightPx).toBe(32);
    expect(sheet.rows.get(1)?.hidden).toBe(true);
    expect(sheet.showGridLines).toBe(false);
  });

  it('is null for a file that is not .xlsx (an .xls or a .csv)', async () => {
    expect(await readWorkbookStyles(new TextEncoder().encode('a,b\n1,2').buffer as ArrayBuffer)).toBeNull();
  });
});

/** A sheet with conditional formatting and a drawing part holding a chart, a picture and a text box. */
async function workbookWithDrawings(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const rel = (id: string, target: string) => `<Relationship Id="${id}" Type="x" Target="${target}"/>`;
  const rels = (...r: string[]) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${r.join('')}</Relationships>`;
  zip.file('xl/workbook.xml', `<workbook ${NS}><sheets><sheet name="Grades" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', rels(rel('rId1', 'worksheets/sheet1.xml')));
  zip.file('xl/styles.xml', `<styleSheet ${NS}><cellXfs count="1"><xf/></cellXfs><dxfs count="1"><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs></styleSheet>`);
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>4</v></c></row></sheetData>
      <conditionalFormatting sqref="A1:A5"><cfRule type="colorScale" priority="2"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="FFF8696B"/><color theme="9"/></colorScale></cfRule>
        <cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan" stopIfTrue="1"><formula>5</formula></cfRule></conditionalFormatting>
      <drawing r:id="rId3"/></worksheet>`,
  );
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', rels(rel('rId3', '../drawings/drawing1.xml')));
  const A = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
  const at = (tag: string, col: number, row: number, off = 0) => `<xdr:${tag}><xdr:col>${col}</xdr:col><xdr:colOff>${off}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
  zip.file(
    'xl/drawings/drawing1.xml',
    `<xdr:wsDr ${A}>
      <xdr:twoCellAnchor>${at('from', 1, 16, 95250)}${at('to', 9, 38)}<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/></xdr:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>
      <xdr:oneCellAnchor>${at('from', 0, 2)}<xdr:ext cx="952500" cy="476250"/><xdr:pic><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>
      <xdr:twoCellAnchor>${at('from', 4, 0)}${at('to', 6, 3)}<xdr:sp><xdr:spPr><a:prstGeom prst="rect"/><a:solidFill><a:srgbClr val="FFFF00"/></a:solidFill></xdr:spPr><xdr:txBody><a:bodyPr/><a:p><a:r><a:t>Note</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>
    </xdr:wsDr>`,
  );
  zip.file('xl/drawings/_rels/drawing1.xml.rels', rels(rel('rId1', '../charts/chart1.xml'), rel('rId2', '../media/image1.png')));
  zip.file('xl/charts/chart1.xml', '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:pieChart><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numLit><c:ptCount val="1"/><c:pt idx="0"><c:v>1</c:v></c:pt></c:numLit></c:val></c:ser></c:pieChart></c:plotArea></c:chart></c:chartSpace>');
  zip.file('xl/media/image1.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('conditional formatting and drawings', () => {
  it('reads the formats rules apply (dxfs) and each sheet\'s rules', async () => {
    const wb = (await readWorkbookStyles(await workbookWithDrawings()))!;
    expect(wb.dxfs[0]).toMatchObject({ bg: '#FFC7CE', color: '#9C0006', bold: true });
    const [scale, cellIs] = wb.sheets.get('Grades')!.conditional;
    expect(scale.ranges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 4, c: 0 } }]);
    expect(scale.colorScale).toEqual({ cfvos: [{ type: 'min', val: undefined }, { type: 'max', val: undefined }], colors: ['#F8696B', '#70AD47'] });
    expect(cellIs).toMatchObject({ type: 'cellIs', operator: 'lessThan', formulas: ['5'], dxfId: 0, priority: 1, stopIfTrue: true });
  });

  it('reads the sheet\'s chart, picture and text box with where they sit', async () => {
    const [chart, picture, box] = (await readWorkbookStyles(await workbookWithDrawings()))!.sheets.get('Grades')!.drawings;
    expect(chart).toMatchObject({ kind: 'chart', name: 'Chart 1', from: { col: 1, row: 16, dx: 10, dy: 0 }, to: { col: 9, row: 38 } });
    expect(chart.chart?.plots[0].type).toBe('pie');
    expect(picture).toMatchObject({ kind: 'image', from: { col: 0, row: 2 }, size: { w: 100, h: 50 } });
    expect(picture.src).toMatch(/^data:image\/png;base64,/);
    expect(box.kind).toBe('shape');
    expect(box.shape).toMatchObject({ fill: '#FFFF00', paragraphs: [{ text: 'Note' }] });
  });
});

describe('helpers', () => {
  // The published tint formula (what LibreOffice uses too); Excel's own palette differs by a few levels at most.
  it('applies Excel\'s tint to within a few levels of Excel\'s own palette', () => {
    expect(near(applyTint('4472C4', 0.79998168889431442), 'D9E1F2')).toBe(true);
    expect(near(applyTint('4472C4', -0.249977111117893), '2F5597')).toBe(true);
    expect(near(applyTint('ED7D31', 0.3999755851924192), 'F4B084')).toBe(true);
    expect(applyTint('FFFFFF', 0)).toBe('FFFFFF');
  });

  it('turns column letters into indexes', () => {
    expect([colIndex('A'), colIndex('Z'), colIndex('AA')]).toEqual([0, 25, 26]);
  });
});

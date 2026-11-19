import { describe, expect, it } from 'vitest';
import { autoColor, DEFAULT_THEME, drawingColor, formatNumber, niceScale, parseChart, readOfficeTheme, renderChartSvg } from './officeChart';

const C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const strCache = (vals: string[]) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (vals: number[]) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
const ser = (i: number, name: string, cats: string[], vals: number[], extra = '') =>
  `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef>${strCache([name])}</c:strRef></c:tx>${extra}<c:cat><c:strRef>${strCache(cats)}</c:strRef></c:cat><c:val><c:numRef>${numCache(vals)}</c:numRef></c:val></c:ser>`;
const PUPILS = ['Marta', 'Ana', 'Elena'];

/** A clustered column chart with data labels plus a dashed red line on the same axes, a title and a data table. */
const combo = `<c:chartSpace ${C}><c:chart>
  <c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr sz="1400"/><a:t>Grades</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
  <c:plotArea>
    <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
      ${ser(0, 'Exam', PUPILS, [9, 8, 7])}${ser(1, 'Practical', PUPILS, [10, 7, 8])}
      <c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/></c:dLbls>
      <c:gapWidth val="219"/><c:axId val="1"/><c:axId val="2"/></c:barChart>
    <c:lineChart><c:grouping val="standard"/>
      ${ser(2, 'Threshold', PUPILS, [6, 6, 6], '<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>')}
      <c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>
    <c:catAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
    <c:valAx><c:axId val="2"/><c:axPos val="l"/><c:majorGridlines/><c:title><c:tx><c:rich><a:p><a:r><a:t>Score</a:t></a:r></a:p></c:rich></c:tx></c:title><c:crossAx val="1"/></c:valAx>
    <c:dTable><c:showHorzBorder val="1"/><c:showVertBorder val="1"/><c:showOutline val="1"/><c:showKeys val="1"/></c:dTable>
  </c:plotArea>
  <c:legend><c:legendPos val="b"/></c:legend>
</c:chart></c:chartSpace>`;

describe('parseChart', () => {
  it('reads the plots, series, categories, values, labels, axes, title, legend and data table', () => {
    const m = parseChart(combo);
    expect(m.unsupported).toBeUndefined();
    expect(m.title?.text).toBe('Grades');
    expect(m.title?.style.sizePt).toBe(14);
    expect(m.plots.map((p) => p.type)).toEqual(['bar', 'line']);
    const [bars, line] = m.plots;
    expect(bars.horizontal).toBe(false);
    expect(bars.series.map((s) => s.name)).toEqual(['Exam', 'Practical']);
    expect(bars.series[0].categories).toEqual(PUPILS);
    expect(bars.series[1].values).toEqual([10, 7, 8]);
    expect(bars.series[0].labels?.showVal).toBe(true);
    expect(line.series[0].stroke).toMatchObject({ color: '#FF0000', width: 3 });
    expect(line.series[0].stroke?.dash).toBeTruthy();
    expect(line.series[0].marker).toBeNull();
    expect(m.axes.get('2')?.title?.text).toBe('Score');
    expect(m.legend?.pos).toBe('b');
    expect(m.dataTable?.keys).toBe(true);
  });

  it('gives series without a color of their own the theme\'s accents in turn', () => {
    const m = parseChart(combo);
    expect(m.plots[0].series.map((s) => s.fill)).toEqual([undefined, undefined]); // picked when drawn
    expect([0, 1, 6].map((i) => autoColor(i, DEFAULT_THEME))).toEqual(['#4472C4', '#ED7D31', expect.stringMatching(/^#/)]);
    expect(autoColor(6, DEFAULT_THEME)).not.toBe('#4472C4'); // the second round is darker
  });

  it('scales the titles with a chart-wide text size (PowerPoint charts use 18pt)', () => {
    const big = combo.replace('<c:chart>', '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1800"/></a:pPr></a:p></c:txPr><c:chart>').replace('<a:rPr sz="1400"/>', '');
    const m = parseChart(big);
    expect(m.title?.style.sizePt).toBe(28);
    expect(m.axes.get('2')?.title?.style.sizePt).toBe(20);
  });

  it('titles a one-series chart with the series name when the file has no title', () => {
    const pie = `<c:chartSpace ${C}><c:chart><c:autoTitleDeleted val="0"/><c:plotArea><c:pieChart><c:varyColors val="1"/>${ser(0, 'Hours', ['A', 'B'], [1, 3])}</c:pieChart></c:plotArea></c:chart></c:chartSpace>`;
    expect(parseChart(pie).title?.text).toBe('Hours');
    expect(parseChart(pie.replace('<c:autoTitleDeleted val="0"/>', '<c:autoTitleDeleted val="1"/>')).title).toBeUndefined();
  });

  it('marks chart kinds it does not draw', () => {
    const radar = `<c:chartSpace ${C}><c:chart><c:plotArea><c:radarChart>${ser(0, 'S', ['a'], [1])}</c:radarChart></c:plotArea></c:chart></c:chartSpace>`;
    expect(parseChart(radar).unsupported).toBeTruthy();
  });
});

describe('renderChartSvg', () => {
  it('draws a bar per value, the labels, the line, the title and the legend', () => {
    const svg = renderChartSvg(parseChart(combo), 600, 400);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 600 400"');
    expect(svg).toContain('>Grades<');
    for (const label of ['9', '10', 'Marta', 'Exam', 'Threshold', 'Score']) expect(svg).toContain(`>${label}<`);
    expect(svg).toContain('stroke-dasharray');
    // 6 bars, in the series colors.
    expect((svg.match(/fill="#4472C4"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((svg.match(/fill="#ED7D31"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('says so instead of drawing a chart kind it does not know', () => {
    const radar = `<c:chartSpace ${C}><c:chart><c:plotArea><c:radarChart>${ser(0, 'S', ['a'], [1])}</c:radarChart></c:plotArea></c:chart></c:chartSpace>`;
    expect(renderChartSvg(parseChart(radar), 300, 200)).toContain('This chart can&#39;t be previewed.');
  });

  it('escapes text from the file', () => {
    const svg = renderChartSvg(parseChart(combo.replace('<a:t>Grades</a:t>', '<a:t>A &amp; &lt;b&gt;</a:t>')), 400, 300);
    expect(svg).toContain('A &amp; &lt;b&gt;');
    expect(svg).not.toContain('<b>');
  });
});

describe('helpers', () => {
  it('picks Excel\'s axis: from zero unless the data sit high, 5% headroom, steps of 1, 2 or 5', () => {
    expect(niceScale(4, 10, 6)).toEqual({ min: 0, max: 12, step: 2 });
    expect(niceScale(90, 100, 6).min).toBeGreaterThan(0);
    expect(niceScale(0, 1, 5, { min: 0, max: 1 })).toMatchObject({ min: 0, max: 1 });
  });

  it('formats numbers with Excel codes', () => {
    expect(formatNumber(0.256, '0%')).toBe('26%');
    expect(formatNumber(1234.5, '#,##0.00')).toBe('1,234.50');
    expect(formatNumber(7.3)).toBe('7.3');
    expect(formatNumber(-5, '0;(0)')).toBe('(5)');
  });

  it('reads theme colors and applies lumMod / lumOff', () => {
    const theme = readOfficeTheme('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="156082"/></a:accent1></a:clrScheme><a:fontScheme><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>');
    expect(theme.colors.accent1).toBe('156082');
    expect(theme.minorFont).toBe('Aptos');
    const el = (xml: string) => new DOMParser().parseFromString(`<x xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</x>`, 'application/xml').documentElement.firstElementChild!;
    expect(drawingColor(el('<a:schemeClr val="accent1"/>'), theme)).toBe('#156082');
    // tx1 at 65% luminance + 35%: Office's gray chart text.
    expect(drawingColor(el('<a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr>'), DEFAULT_THEME)).toBe('#595959');
  });
});

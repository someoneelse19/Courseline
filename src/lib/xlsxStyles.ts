// Cell formatting from an .xlsx/.xlsm file: fills, fonts, borders, alignment, column widths, row heights, gridlines,
// conditional formatting rules (evaluated in lib/xlsxConditional.ts), and what floats over the cells: charts (drawn by
// lib/officeChart.ts), pictures and text boxes. SheetJS (community edition) reads values and number formats but none of
// this, so the viewer reads the parts of the file that hold it (xl/styles.xml, the theme, each sheet's XML, its drawing
// and chart parts) here and draws the sheet itself. Pure (JSZip and DOMParser only), so it can be tested.
import JSZip from 'jszip';
import { drawingColor, fillOf, parseChart, readOfficeTheme, strokeOf, type ChartModel, type OfficeTheme, type Stroke } from './officeChart';
import { parseSqref, type Cfvo, type ConditionalRule } from './xlsxConditional';

export interface CellStyle {
  bg?: string; // CSS color
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSizePt?: number;
  fontName?: string;
  hAlign?: string; // left | center | right | justify | fill | centerContinuous | general
  vAlign?: string; // top | center | bottom
  wrap?: boolean;
  indent?: number;
  borders?: Partial<Record<'top' | 'right' | 'bottom' | 'left', string>>; // CSS border shorthands
}

export interface SheetLayout {
  /** Cell reference ("B3") -> index into `WorkbookStyles.xfs`. */
  cellStyle: Map<string, number>;
  /** 0-based column -> width in px, and whether it is hidden. */
  cols: Map<number, { widthPx?: number; hidden?: boolean }>;
  /** 0-based row -> height in px, and whether it is hidden. */
  rows: Map<number, { heightPx?: number; hidden?: boolean }>;
  defaultColWidthPx: number;
  defaultRowHeightPx: number;
  showGridLines: boolean;
  /** Conditional formatting rules, as the sheet lists them. */
  conditional: ConditionalRule[];
  /** Charts, pictures and text boxes over the cells. */
  drawings: SheetDrawing[];
}

/** Where a drawing sits: a cell (0-based) plus an offset into it, in px. */
export interface CellAnchor {
  col: number;
  row: number;
  dx: number;
  dy: number;
}
export interface SheetDrawing {
  from: CellAnchor;
  /** The bottom-right corner, for drawings that stretch with their cells. */
  to?: CellAnchor;
  /** The size in px, for drawings anchored by one corner. */
  size?: { w: number; h: number };
  kind: 'chart' | 'image' | 'shape';
  chart?: ChartModel;
  /** A picture, as a data: URL. */
  src?: string;
  shape?: { fill?: string; stroke?: Stroke; round: boolean; ellipse: boolean; paragraphs: { text: string; align: string }[]; text: { sizePt: number; color: string; bold: boolean; italic: boolean }; vAlign: string };
  name?: string;
}

export interface WorkbookStyles {
  xfs: CellStyle[];
  /** The formats conditional rules apply (`dxfId`). */
  dxfs: CellStyle[];
  /** Sheet name -> its layout. */
  sheets: Map<string, SheetLayout>;
}

// Excel's built-in palette for `indexed` colors (0-63; 64 = system text, 65 = system background).
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

// Theme color order as cells refer to it: 0 = lt1 (background), 1 = dk1 (text), 2 = lt2, 3 = dk2, then accents and links.
const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function parse(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}
/** Child elements with this local name (namespace prefixes vary between files). */
const kids = (el: Element | Document | null | undefined, name: string): Element[] =>
  el ? [...(el instanceof Document ? el.documentElement.children : el.children)].filter((c) => c.localName === name) : [];
const kid = (el: Element | Document | null | undefined, name: string) => kids(el, name)[0];
const all = (el: Element | Document, name: string): Element[] => [...el.getElementsByTagNameNS(NS_MAIN, name), ...el.getElementsByTagNameNS('*', name)].filter((v, i, a) => a.indexOf(v) === i);

// --- colors -------------------------------------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** Excel's tint: lighten (tint > 0) or darken (tint < 0) a color's luminance in HLS. */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  return [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** A <color>, <fgColor>, <bgColor> element as a CSS color, or undefined for "automatic"/none. */
export function colorOf(el: Element | undefined, theme: string[]): string | undefined {
  if (!el || el.getAttribute('auto') === '1') return undefined;
  let hex: string | undefined;
  const rgb = el.getAttribute('rgb');
  const themeIdx = el.getAttribute('theme');
  const indexed = el.getAttribute('indexed');
  if (rgb && /^[0-9A-Fa-f]{6,8}$/.test(rgb)) hex = rgb.slice(-6);
  else if (themeIdx !== null) hex = theme[Number(themeIdx)];
  else if (indexed !== null) {
    const i = Number(indexed);
    if (i === 64 || i === 65) return undefined; // the system text / background colors: the defaults
    hex = INDEXED[i];
  }
  if (!hex) return undefined;
  const tint = Number(el.getAttribute('tint') ?? 0);
  return `#${applyTint(hex.toUpperCase(), Number.isFinite(tint) ? tint : 0)}`;
}

function readTheme(xml: string | null): string[] {
  if (!xml) return DEFAULT_THEME;
  const doc = parse(xml);
  const scheme = doc.getElementsByTagNameNS('*', 'clrScheme')[0];
  if (!scheme) return DEFAULT_THEME;
  return THEME_ORDER.map((name, i) => {
    const entry = kid(scheme, name);
    const srgb = kid(entry, 'srgbClr')?.getAttribute('val');
    const sys = kid(entry, 'sysClr')?.getAttribute('lastClr');
    return (srgb ?? sys ?? DEFAULT_THEME[i]).toUpperCase();
  });
}

// --- styles.xml ---------------------------------------------------------------------------------------------------

const BORDER_WIDTH: Record<string, string> = { thin: '1px solid', hair: '1px solid', dotted: '1px dotted', dashed: '1px dashed', dashDot: '1px dashed', dashDotDot: '1px dotted', medium: '2px solid', mediumDashed: '2px dashed', mediumDashDot: '2px dashed', mediumDashDotDot: '2px dotted', slantDashDot: '2px dashed', thick: '3px solid', double: '3px double' };

export function readStyles(stylesXml: string | null, theme: string[]): CellStyle[] {
  if (!stylesXml) return [];
  const doc = parse(stylesXml);
  const root = doc.documentElement;

  const fonts = kids(kid(root, 'fonts'), 'font').map((f) => {
    const val = (n: string) => kid(f, n);
    const on = (n: string) => !!val(n) && val(n)!.getAttribute('val') !== '0' && val(n)!.getAttribute('val') !== 'false';
    const size = Number(val('sz')?.getAttribute('val'));
    return {
      bold: on('b') || undefined,
      italic: on('i') || undefined,
      underline: (!!val('u') && val('u')!.getAttribute('val') !== 'none') || undefined,
      strike: on('strike') || undefined,
      fontSizePt: Number.isFinite(size) && size > 0 ? size : undefined,
      fontName: val('name')?.getAttribute('val') ?? undefined,
      color: colorOf(val('color'), theme),
    };
  });

  const fills = kids(kid(root, 'fills'), 'fill').map((f) => {
    const pattern = kid(f, 'patternFill');
    if (pattern) {
      const type = pattern.getAttribute('patternType') ?? 'none';
      if (type === 'none' || type === 'gray125') return undefined;
      return colorOf(kid(pattern, 'fgColor'), theme) ?? colorOf(kid(pattern, 'bgColor'), theme);
    }
    const gradient = kid(f, 'gradientFill');
    return gradient ? colorOf(kid(kid(gradient, 'stop'), 'color'), theme) : undefined;
  });

  const borders = kids(kid(root, 'borders'), 'border').map((b) => {
    const out: CellStyle['borders'] = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const el = kid(b, side);
      const style = el?.getAttribute('style');
      if (!el || !style || style === 'none') continue;
      out[side] = `${BORDER_WIDTH[style] ?? '1px solid'} ${colorOf(kid(el, 'color'), theme) ?? '#000000'}`;
    }
    return Object.keys(out).length ? out : undefined;
  });

  return kids(kid(root, 'cellXfs'), 'xf').map((xf) => {
    const num = (n: string) => Number(xf.getAttribute(n) ?? 0);
    const font = fonts[num('fontId')] ?? {};
    const align = kid(xf, 'alignment');
    const style: CellStyle = { ...font, bg: fills[num('fillId')], borders: borders[num('borderId')] };
    if (align) {
      style.hAlign = align.getAttribute('horizontal') ?? undefined;
      style.vAlign = align.getAttribute('vertical') ?? undefined;
      style.wrap = align.getAttribute('wrapText') === '1' || align.getAttribute('wrapText') === 'true' || undefined;
      const indent = Number(align.getAttribute('indent'));
      style.indent = indent > 0 ? indent : undefined;
    }
    return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as CellStyle;
  });
}

/** The differential formats (<dxfs>) conditional rules point at: fill, font color and font style. */
export function readDxfs(stylesXml: string | null, theme: string[]): CellStyle[] {
  if (!stylesXml) return [];
  const root = parse(stylesXml).documentElement;
  return kids(kid(root, 'dxfs'), 'dxf').map((d) => {
    const font = kid(d, 'font');
    const flag = (n: string) => {
      const e = kid(font, n);
      return e ? e.getAttribute('val') !== '0' && e.getAttribute('val') !== 'false' : undefined;
    };
    const pattern = kid(kid(d, 'fill'), 'patternFill');
    // In a dxf, a solid fill's color is usually its bgColor (fgColor in some files).
    const bg = pattern && pattern.getAttribute('patternType') !== 'none' ? (colorOf(kid(pattern, 'bgColor'), theme) ?? colorOf(kid(pattern, 'fgColor'), theme)) : undefined;
    const style: CellStyle = { bg, color: colorOf(kid(font, 'color'), theme), bold: flag('b'), italic: flag('i'), strike: flag('strike'), underline: kid(font, 'u') ? kid(font, 'u')!.getAttribute('val') !== 'none' : undefined };
    return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as CellStyle;
  });
}

// --- each sheet ---------------------------------------------------------------------------------------------------

/** Column letters -> 0-based index ("A" -> 0, "AA" -> 26). */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Excel measures column widths in characters of the default font (about 7 px each, plus 5 px padding).
const charsToPx = (w: number) => Math.round(w * 7 + 5);
const ptToPx = (pt: number) => Math.round((pt * 96) / 72);

/** A sheet's conditional formatting rules (colors resolved against the theme). */
export function readConditionalRules(root: Element, theme: string[]): ConditionalRule[] {
  const rules: ConditionalRule[] = [];
  for (const cf of kids(root, 'conditionalFormatting')) {
    const ranges = parseSqref(cf.getAttribute('sqref') ?? '');
    if (!ranges.length) continue;
    for (const rule of kids(cf, 'cfRule')) {
      const attr = (n: string) => rule.getAttribute(n) ?? undefined;
      const numAttr = (n: string) => (rule.hasAttribute(n) ? Number(rule.getAttribute(n)) : undefined);
      const cfvos = (el: Element | undefined): Cfvo[] => kids(el, 'cfvo').map((v) => ({ type: v.getAttribute('type') ?? 'min', val: v.getAttribute('val') ?? undefined }));
      const scale = kid(rule, 'colorScale');
      const bar = kid(rule, 'dataBar');
      const colors = (el: Element | undefined) => kids(el, 'color').map((c) => colorOf(c, theme) ?? '#FFFFFF');
      rules.push({
        ranges,
        priority: numAttr('priority') ?? 1000,
        stopIfTrue: attr('stopIfTrue') === '1' || attr('stopIfTrue') === 'true',
        type: attr('type') ?? '',
        operator: attr('operator'),
        formulas: kids(rule, 'formula').map((f) => f.textContent ?? ''),
        text: attr('text'),
        dxfId: numAttr('dxfId'),
        colorScale: scale ? { cfvos: cfvos(scale), colors: colors(scale) } : undefined,
        dataBar: bar ? { cfvos: cfvos(bar), color: colors(bar)[0] ?? '#638EC6', showValue: bar.getAttribute('showValue') !== '0' } : undefined,
        rank: numAttr('rank'),
        percent: attr('percent') === '1' || attr('percent') === 'true',
        bottom: attr('bottom') === '1' || attr('bottom') === 'true',
        aboveAverage: attr('aboveAverage') === undefined ? undefined : attr('aboveAverage') !== '0' && attr('aboveAverage') !== 'false',
        equalAverage: attr('equalAverage') === '1' || attr('equalAverage') === 'true',
        stdDev: numAttr('stdDev'),
      });
    }
  }
  return rules.filter((r) => (r.type === 'colorScale' ? !!r.colorScale?.colors.length : r.type === 'dataBar' ? !!r.dataBar : true));
}

export function readSheet(xml: string, maxRows = Infinity, theme: string[] = DEFAULT_THEME): SheetLayout {
  const doc = parse(xml);
  const root = doc.documentElement;
  const view = kid(kid(root, 'sheetViews'), 'sheetView');
  const format = kid(root, 'sheetFormatPr');
  const defaultColChars = Number(format?.getAttribute('defaultColWidth') ?? format?.getAttribute('baseColWidth') ?? NaN);
  const defaultRowPt = Number(format?.getAttribute('defaultRowHeight') ?? 15);
  const cols: SheetLayout['cols'] = new Map();
  for (const c of kids(kid(root, 'cols'), 'col')) {
    const min = Number(c.getAttribute('min'));
    const max = Math.min(Number(c.getAttribute('max')), min + 1000);
    const width = Number(c.getAttribute('width'));
    const hidden = c.getAttribute('hidden') === '1' || c.getAttribute('hidden') === 'true';
    for (let i = min; i <= max; i++) cols.set(i - 1, { widthPx: Number.isFinite(width) && width > 0 ? charsToPx(width) : undefined, hidden: hidden || undefined });
  }
  const rows: SheetLayout['rows'] = new Map();
  const cellStyle: SheetLayout['cellStyle'] = new Map();
  for (const r of kids(kid(root, 'sheetData'), 'row')) {
    const index = Number(r.getAttribute('r')) - 1;
    if (!(index >= 0) || index >= maxRows) continue;
    const ht = Number(r.getAttribute('ht'));
    const hidden = r.getAttribute('hidden') === '1' || r.getAttribute('hidden') === 'true';
    if ((Number.isFinite(ht) && ht > 0) || hidden) rows.set(index, { heightPx: Number.isFinite(ht) && ht > 0 ? ptToPx(ht) : undefined, hidden: hidden || undefined });
    for (const c of kids(r, 'c')) {
      const ref = c.getAttribute('r');
      const s = c.getAttribute('s');
      if (ref && s && s !== '0') cellStyle.set(ref, Number(s));
    }
  }
  return {
    cellStyle,
    cols,
    rows,
    defaultColWidthPx: Number.isFinite(defaultColChars) && defaultColChars > 0 ? charsToPx(defaultColChars) : 64,
    defaultRowHeightPx: ptToPx(Number.isFinite(defaultRowPt) && defaultRowPt > 0 ? defaultRowPt : 15),
    showGridLines: view?.getAttribute('showGridLines') !== '0' && view?.getAttribute('showGridLines') !== 'false',
    conditional: readConditionalRules(root, theme),
    drawings: [],
  };
}

// --- drawings (charts, pictures, text boxes) -------------------------------------------------------------------------

const EMU_PER_PX = 9525;
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };

/** A part's relationships: id -> the target's path inside the zip. */
async function relsOf(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1);
  const relsPath = `${dir}_rels/${partPath.slice(dir.length)}.rels`;
  const xml = await zip.file(relsPath)?.async('string');
  const out = new Map<string, string>();
  if (!xml) return out;
  for (const r of all(parse(xml), 'Relationship')) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    out.set(r.getAttribute('Id') ?? '', resolvePath(dir, r.getAttribute('Target') ?? ''));
  }
  return out;
}
/** A relationship target relative to `dir` ("../charts/chart1.xml" from "xl/drawings/") as a zip path. */
export function resolvePath(dir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = dir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function anchorOf(el: Element | undefined): CellAnchor | undefined {
  if (!el) return undefined;
  const n = (name: string) => Number(kid(el, name)?.textContent ?? 0) || 0;
  return { col: n('col'), row: n('row'), dx: n('colOff') / EMU_PER_PX, dy: n('rowOff') / EMU_PER_PX };
}

/** The picture, chart or text box in one anchor (the first one it holds; groups are not drawn). */
async function drawingContent(el: Element, zip: JSZip, rels: Map<string, string>, theme: OfficeTheme): Promise<Omit<SheetDrawing, 'from' | 'to' | 'size'> | null> {
  for (const child of el.children) {
    switch (child.localName) {
      case 'AlternateContent': {
        // Newer kinds of chart (waterfall, histogram, map...) come as a choice with an old-Excel fallback.
        const choice = kid(child, 'Choice');
        const frame = kid(choice, 'graphicFrame');
        const data = frame?.getElementsByTagNameNS('*', 'graphicData')[0];
        if (data && /chartex|2014\/chartex/.test(data.getAttribute('uri') ?? '')) return { kind: 'chart', chart: { ...parseChart('<c:chartSpace xmlns:c="x"/>', theme), unsupported: 'newer Office' } };
        const inner = choice ? await drawingContent(choice, zip, rels, theme) : null;
        if (inner) return inner;
        const fallback = kid(child, 'Fallback');
        if (fallback) return drawingContent(fallback, zip, rels, theme);
        break;
      }
      case 'graphicFrame': {
        const chartRef = child.getElementsByTagNameNS('*', 'chart')[0];
        const id = chartRef?.getAttributeNS(NS_REL, 'id') ?? chartRef?.getAttribute('r:id');
        const target = id ? rels.get(id) : undefined;
        const xml = target ? await zip.file(target)?.async('string') : undefined;
        if (xml) return { kind: 'chart', chart: parseChart(xml, theme), name: child.getElementsByTagNameNS('*', 'cNvPr')[0]?.getAttribute('name') ?? undefined };
        break;
      }
      case 'pic': {
        const blip = child.getElementsByTagNameNS('*', 'blip')[0];
        const id = blip?.getAttributeNS(NS_REL, 'embed') ?? blip?.getAttribute('r:embed');
        const target = id ? rels.get(id) : undefined;
        const type = target ? IMAGE_TYPES[target.split('.').pop()!.toLowerCase()] : undefined;
        const file = target && type ? zip.file(target) : null;
        // An SVG picture could carry script: shown through <img>, which never runs it.
        if (file) return { kind: 'image', src: `data:${type};base64,${await file.async('base64')}`, name: child.getElementsByTagNameNS('*', 'cNvPr')[0]?.getAttribute('descr') ?? undefined };
        break;
      }
      case 'sp': {
        const spPr = kid(child, 'spPr');
        const geom = kid(spPr, 'prstGeom')?.getAttribute('prst') ?? 'rect';
        const body = kid(child, 'txBody');
        const paragraphs = kids(body, 'p').map((p) => ({
          text: [...p.children].filter((r) => r.localName === 'r' || r.localName === 'fld' || r.localName === 'br').map((r) => (r.localName === 'br' ? '\n' : (kid(r, 't')?.textContent ?? ''))).join(''),
          align: kid(p, 'pPr')?.getAttribute('algn') ?? 'l',
        }));
        const rPr = body?.getElementsByTagNameNS('*', 'rPr')[0] ?? body?.getElementsByTagNameNS('*', 'defRPr')[0];
        // The shape's style (<xdr:style>) gives the colors the file leaves automatic: fillRef / lnRef / fontRef.
        const style = kid(child, 'style');
        const styleColor = (ref: string) => drawingColor([...(kid(style, ref)?.children ?? [])][0], theme);
        const fill = fillOf(spPr, theme) ?? styleColor('fillRef');
        const stroke = strokeOf(spPr, theme) ?? (style ? { color: styleColor('lnRef') ?? '#000000', width: 1 } : undefined);
        const sz = Number(rPr?.getAttribute('sz'));
        const textColor = fillOf(rPr ?? undefined, theme);
        return {
          kind: 'shape',
          shape: {
            fill,
            stroke: stroke && stroke.color === 'auto' ? { ...stroke, color: '#000000' } : stroke,
            round: geom === 'roundRect',
            ellipse: geom === 'ellipse',
            paragraphs,
            text: {
              sizePt: sz > 0 ? sz / 100 : 11,
              color: textColor && textColor !== 'none' ? textColor : (styleColor('fontRef') ?? '#000000'),
              bold: rPr?.getAttribute('b') === '1',
              italic: rPr?.getAttribute('i') === '1',
            },
            vAlign: kid(body, 'bodyPr')?.getAttribute('anchor') ?? 't',
          },
        };
      }
    }
  }
  return null;
}

/** A sheet's drawing part: every anchored chart, picture and text box. */
export async function readDrawings(zip: JSZip, drawingPath: string, theme: OfficeTheme): Promise<SheetDrawing[]> {
  const xml = await zip.file(drawingPath)?.async('string');
  if (!xml) return [];
  const rels = await relsOf(zip, drawingPath);
  const out: SheetDrawing[] = [];
  for (const a of parse(xml).documentElement.children) {
    if (!['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(a.localName)) continue;
    const content = await drawingContent(a, zip, rels, theme).catch(() => null);
    if (!content) continue;
    const ext = kid(a, 'ext');
    const size = ext ? { w: Number(ext.getAttribute('cx')) / EMU_PER_PX, h: Number(ext.getAttribute('cy')) / EMU_PER_PX } : undefined;
    if (a.localName === 'absoluteAnchor') {
      const pos = kid(a, 'pos');
      if (!size) continue;
      // Rare: placed in px from the sheet's corner. Expressed as an offset from A1.
      out.push({ ...content, from: { col: 0, row: 0, dx: Number(pos?.getAttribute('x') ?? 0) / EMU_PER_PX, dy: Number(pos?.getAttribute('y') ?? 0) / EMU_PER_PX }, size });
      continue;
    }
    const from = anchorOf(kid(a, 'from'));
    if (!from) continue;
    out.push({ ...content, from, to: a.localName === 'twoCellAnchor' ? anchorOf(kid(a, 'to')) : undefined, size: a.localName === 'oneCellAnchor' ? size : undefined });
  }
  return out;
}

/** The formatting of every sheet of an .xlsx/.xlsm file, or null when it is not one (an .xls, .ods or .csv). */
export async function readWorkbookStyles(bytes: ArrayBuffer, maxRows = Infinity): Promise<WorkbookStyles | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return null; // not a zip: an older or other format
  }
  const text = async (path: string) => (await zip.file(path)?.async('string')) ?? null;
  const workbookXml = await text('xl/workbook.xml');
  if (!workbookXml) return null;
  const themeXml = await text('xl/theme/theme1.xml');
  const theme = readTheme(themeXml);
  const officeTheme = readOfficeTheme(themeXml);
  const stylesXml = await text('xl/styles.xml');
  const xfs = readStyles(stylesXml, theme);
  const dxfs = readDxfs(stylesXml, theme);

  // Sheet names -> their files, through the workbook's relationships.
  const rels = new Map<string, string>();
  const relsXml = await text('xl/_rels/workbook.xml.rels');
  if (relsXml) for (const r of all(parse(relsXml), 'Relationship')) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
  const sheets: WorkbookStyles['sheets'] = new Map();
  for (const s of all(parse(workbookXml), 'sheet')) {
    const name = s.getAttribute('name');
    const id = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id');
    const target = id ? rels.get(id) : undefined;
    if (!name || !target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await text(path);
    if (!xml) continue;
    const layout = readSheet(xml, maxRows, theme);
    // Its drawing part, through the sheet's relationships.
    const drawingId = xml.match(/<(?:\w+:)?drawing\b[^>]*\br:id="([^"]+)"/)?.[1];
    if (drawingId) {
      const target = (await relsOf(zip, path)).get(drawingId);
      if (target) layout.drawings = await readDrawings(zip, target, officeTheme).catch(() => []);
    }
    sheets.set(name, layout);
  }
  return { xfs, dxfs, sheets };
}

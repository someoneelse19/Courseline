// Cell formatting from an .xlsx/.xlsm file: fills, fonts, borders, alignment, column widths, row heights, gridlines.
// SheetJS (community edition) reads values and number formats but not formatting, so the viewer reads the parts of the
// file that hold it (xl/styles.xml, the theme, each sheet's XML) here and draws the sheet itself. Pure (JSZip and
// DOMParser only), so it can be tested.
import JSZip from 'jszip';

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
}

export interface WorkbookStyles {
  xfs: CellStyle[];
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

export function readSheet(xml: string, maxRows = Infinity): SheetLayout {
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
  };
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
  const theme = readTheme(await text('xl/theme/theme1.xml'));
  const xfs = readStyles(await text('xl/styles.xml'), theme);

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
    if (xml) sheets.set(name, readSheet(xml, maxRows));
  }
  return { xfs, sheets };
}

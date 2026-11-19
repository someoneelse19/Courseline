// Office charts (DrawingML chart parts: xl/charts/chartN.xml, word/charts/chartN.xml, ppt/charts/chartN.xml), read into a
// small model and drawn as an SVG string. Excel, Word and PowerPoint all store charts this way, with the numbers and
// labels cached in the part itself, so no formulas are needed. The SVG is shown through <img> (a data: URL, or a picture
// put into a .docx), where nothing in it can run, and every piece of text from the file is escaped.
//
// Drawn: column and bar (clustered, stacked, 100%), line, area, pie, doughnut and scatter, their 3-D variants flat,
// combinations of them, secondary value axes, titles, axis titles, gridlines, data labels, legends and data tables, in
// the file's colors (theme colors with their modifiers). Other kinds (radar, bubble, stock, surface, the 2016 "chartex"
// kinds) get a framed note instead ("This chart can't be previewed.", translated). The layout is Excel's automatic one;
// a manual layout dragged by hand is not followed. Text sizes follow the chart's own (PowerPoint charts are 18pt).
//
// Used by the spreadsheet view (lib/xlsxStyles.ts, components/FileViewer.tsx), Word (lib/docxCharts.ts) and
// PowerPoint (lib/pptxCharts.ts).

import { t } from '../i18n';

// --- theme ----------------------------------------------------------------------------------------------------------

export interface OfficeTheme {
  /** dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink -> hex RRGGBB. */
  colors: Record<string, string>;
  minorFont: string;
  majorFont: string;
}

const DEFAULT_COLORS: Record<string, string> = {
  dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5',
  accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72',
};
export const DEFAULT_THEME: OfficeTheme = { colors: DEFAULT_COLORS, minorFont: 'Calibri', majorFont: 'Calibri Light' };

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml');
}
/** Child elements with this local name (prefixes vary between files). */
const kids = (el: Element | null | undefined, name: string): Element[] => (el ? [...el.children].filter((c) => c.localName === name) : []);
const kid = (el: Element | null | undefined, name: string): Element | undefined => kids(el, name)[0];
const path = (el: Element | null | undefined, ...names: string[]): Element | undefined => names.reduce<Element | undefined>((e, n) => kid(e, n), el ?? undefined);
const val = (el: Element | null | undefined, name: string): string | undefined => kid(el, name)?.getAttribute('val') ?? undefined;
const on = (el: Element | null | undefined, name: string, dflt = false): boolean => {
  const e = kid(el, name);
  if (!e) return dflt;
  const v = e.getAttribute('val');
  return v === null ? true : v === '1' || v === 'true';
};
const num = (s: string | null | undefined): number | undefined => {
  if (s === null || s === undefined || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export function readOfficeTheme(xml: string | null | undefined): OfficeTheme {
  if (!xml) return DEFAULT_THEME;
  const doc = parseXml(xml);
  const scheme = doc.getElementsByTagNameNS('*', 'clrScheme')[0];
  const colors = { ...DEFAULT_COLORS };
  if (scheme)
    for (const name of Object.keys(DEFAULT_COLORS)) {
      const entry = kid(scheme, name);
      const hex = kid(entry, 'srgbClr')?.getAttribute('val') ?? kid(entry, 'sysClr')?.getAttribute('lastClr');
      if (hex && /^[0-9a-f]{6}$/i.test(hex)) colors[name] = hex.toUpperCase();
    }
  const font = (n: string) => doc.getElementsByTagNameNS('*', n)[0]?.getElementsByTagNameNS('*', 'latin')[0]?.getAttribute('typeface') || undefined;
  return { colors, minorFont: font('minorFont') ?? DEFAULT_THEME.minorFont, majorFont: font('majorFont') ?? DEFAULT_THEME.majorFont };
}

// --- DrawingML colors -----------------------------------------------------------------------------------------------

const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', orange: 'FFA500', gray: '808080', grey: '808080',
  darkGray: 'A9A9A9', lightGray: 'D3D3D3', purple: '800080', navy: '000080', teal: '008080', maroon: '800000', lime: '00FF00', cyan: '00FFFF', magenta: 'FF00FF',
};
const SYSTEM: Record<string, string> = { windowText: '000000', window: 'FFFFFF', btnFace: 'F0F0F0', highlight: '0078D7', grayText: '6D6D6D' };

type Rgb = [number, number, number]; // 0..1

const toRgb = (hex: string): Rgb => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const toHex = (c: Rgb) => c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function rgbToHsl([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  return [h, s, l];
}
function hslToRgb([h, s, l]: Rgb): Rgb {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** A color element (srgbClr, schemeClr, sysClr, prstClr, scrgbClr) with its modifiers, as a CSS color. */
export function drawingColor(el: Element | undefined, theme: OfficeTheme): string | undefined {
  if (!el) return undefined;
  let hex: string | undefined;
  const v = el.getAttribute('val') ?? '';
  switch (el.localName) {
    case 'srgbClr':
      hex = /^[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : undefined;
      break;
    case 'schemeClr':
      hex = theme.colors[SCHEME_ALIAS[v] ?? v];
      break;
    case 'sysClr':
      hex = el.getAttribute('lastClr') ?? SYSTEM[v];
      break;
    case 'prstClr':
      hex = PRESET[v];
      break;
    case 'scrgbClr': {
      const c = ['r', 'g', 'b'].map((k) => fromLinear((num(el.getAttribute(k)) ?? 0) / 100000)) as Rgb;
      hex = toHex(c);
      break;
    }
  }
  if (!hex) return undefined;
  let rgb = toRgb(hex);
  let alpha = 1;
  for (const m of el.children) {
    const amount = (num(m.getAttribute('val')) ?? 0) / 100000;
    switch (m.localName) {
      case 'lumMod': {
        const hsl = rgbToHsl(rgb);
        rgb = hslToRgb([hsl[0], hsl[1], Math.min(1, hsl[2] * amount)]);
        break;
      }
      case 'lumOff': {
        const hsl = rgbToHsl(rgb);
        rgb = hslToRgb([hsl[0], hsl[1], Math.min(1, Math.max(0, hsl[2] + amount))]);
        break;
      }
      case 'satMod': {
        const hsl = rgbToHsl(rgb);
        rgb = hslToRgb([hsl[0], Math.min(1, hsl[1] * amount), hsl[2]]);
        break;
      }
      case 'shade':
        rgb = rgb.map((c) => fromLinear(toLinear(c) * amount)) as Rgb;
        break;
      case 'tint':
        rgb = rgb.map((c) => fromLinear(1 - (1 - toLinear(c)) * amount)) as Rgb;
        break;
      case 'alpha':
        alpha = amount;
        break;
    }
  }
  const out = toHex(rgb);
  if (alpha < 1) {
    const [r, g, b] = toRgb(out).map((c) => Math.round(c * 255));
    return `rgba(${r},${g},${b},${Number(alpha.toFixed(3))})`;
  }
  return `#${out}`;
}

const COLOR_TAGS = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr']);
const colorIn = (el: Element | undefined, theme: OfficeTheme) => drawingColor([...(el?.children ?? [])].find((c) => COLOR_TAGS.has(c.localName)), theme);

/** A fill (a:solidFill, a:gradFill, a:pattFill, a:noFill) under `parent`: a CSS color, 'none', or undefined (automatic). */
export function fillOf(parent: Element | undefined, theme: OfficeTheme): string | undefined {
  if (!parent) return undefined;
  if (kid(parent, 'noFill')) return 'none';
  const solid = kid(parent, 'solidFill');
  if (solid) return colorIn(solid, theme);
  const grad = kid(parent, 'gradFill');
  if (grad) {
    const stops = kids(kid(grad, 'gsLst'), 'gs');
    return colorIn(stops[Math.floor(stops.length / 2)] ?? stops[0], theme);
  }
  const patt = kid(parent, 'pattFill');
  if (patt) return colorIn(kid(patt, 'fgClr'), theme);
  return undefined;
}

export interface Stroke {
  color: string; // CSS color, or 'none'
  width: number; // px
  dash?: string; // SVG stroke-dasharray
}

const DASH: Record<string, number[]> = {
  dash: [4, 3], lgDash: [8, 3], sysDash: [3, 1], sysDot: [1, 1], dot: [1, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

/** The outline (a:ln) of a shape's properties; undefined when the file leaves it automatic. */
export function strokeOf(spPr: Element | undefined, theme: OfficeTheme): Stroke | undefined {
  const ln = kid(spPr, 'ln');
  if (!ln) return undefined;
  const width = ln.hasAttribute('w') ? (num(ln.getAttribute('w')) ?? 9525) / 9525 : undefined;
  const color = fillOf(ln, theme);
  if (color === undefined && width === undefined) return undefined;
  const w = width ?? 1;
  const pattern = DASH[val(ln, 'prstDash') ?? 'solid'];
  return { color: color ?? 'auto', width: w, dash: pattern ? pattern.map((d) => Number((d * Math.max(w, 1)).toFixed(2))).join(' ') : undefined };
}

// --- number formats -------------------------------------------------------------------------------------------------

function general(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e11 || abs < 1e-9) return v.toExponential(5).replace(/\.?0+e/, 'E').replace('E+', 'E+').replace(/e/, 'E');
  return String(Number(v.toPrecision(10)));
}

const DATE_TOKEN = /(yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM)/gi;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(serial: number, code: string): string {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  const pad = (n: number) => String(n).padStart(2, '0');
  let lastWasHour = false;
  return code.replace(DATE_TOKEN, (tok) => {
    const t = tok.toLowerCase();
    const hourish = lastWasHour;
    lastWasHour = t.startsWith('h');
    switch (t) {
      case 'yyyy': return String(d.getUTCFullYear());
      case 'yy': return pad(d.getUTCFullYear() % 100);
      case 'mmmm': return MONTHS[d.getUTCMonth()];
      case 'mmm': return MONTHS[d.getUTCMonth()].slice(0, 3);
      case 'mm': return hourish ? pad(d.getUTCMinutes()) : pad(d.getUTCMonth() + 1);
      case 'm': return hourish ? String(d.getUTCMinutes()) : String(d.getUTCMonth() + 1);
      case 'dddd': return DAYS[d.getUTCDay()];
      case 'ddd': return DAYS[d.getUTCDay()].slice(0, 3);
      case 'dd': return pad(d.getUTCDate());
      case 'd': return String(d.getUTCDate());
      case 'hh': return pad(d.getUTCHours());
      case 'h': return String(d.getUTCHours());
      case 'ss': return pad(d.getUTCSeconds());
      case 's': return String(d.getUTCSeconds());
      default: return tok;
    }
  });
}

/** A number as an Excel number format shows it (the common shapes: General, 0.00, #,##0, percentages, literals, dates). */
export function formatNumber(v: number, code = 'General'): string {
  if (!Number.isFinite(v)) return '';
  const sections = code.split(';');
  let section = sections[0];
  let value = v;
  if (v < 0 && sections.length > 1) {
    section = sections[1];
    value = -v;
  } else if (v === 0 && sections.length > 2) section = sections[2];
  section = section.replace(/\[[^\]]*\]/g, '').replace(/_./g, '').replace(/\*./g, '');
  if (!section.trim() || /^general$/i.test(section.trim())) return general(v);
  const unquoted = section.replace(/"[^"]*"/g, '');
  if (/[dmyhs]/i.test(unquoted) && !/[0#?]/.test(unquoted)) return formatDate(value, section.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1'));
  const m = section.match(/[#0?][#0?,]*(\.[#0?]*)?/);
  if (!m || m.index === undefined) return section.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1');
  const literal = (s: string) => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1');
  const before = literal(section.slice(0, m.index));
  const after = literal(section.slice(m.index + m[0].length));
  const percent = (before + after).includes('%');
  let n = percent ? value * 100 : value;
  const intPart = m[0].split('.')[0];
  const decPart = m[1] ? m[1].slice(1) : '';
  const scale = (intPart.match(/,+$/)?.[0].length ?? 0) * 3; // trailing commas divide by 1000
  if (scale) n /= 10 ** scale;
  const minDec = (decPart.match(/0/g) ?? []).length;
  const maxDec = decPart.length;
  let text = Math.abs(n).toFixed(maxDec);
  if (maxDec > minDec) text = text.replace(new RegExp(`0{1,${maxDec - minDec}}$`), '').replace(/\.$/, '');
  let [whole, frac] = text.split('.');
  if (/,(?=[#0?])/.test(intPart)) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const minInt = (intPart.replace(/,/g, '').match(/0/g) ?? []).length;
  if (whole === '0' && minInt === 0 && frac) whole = '';
  const sign = n < 0 && sections.length === 1 ? '-' : '';
  return `${sign}${before}${whole}${frac ? `.${frac}` : ''}${after}`;
}

// --- the model ------------------------------------------------------------------------------------------------------

export interface TextStyle {
  sizePt: number;
  color: string;
  bold: boolean;
  italic: boolean;
}
export interface Label {
  text: string;
  style: TextStyle;
}
export interface DataLabels {
  showVal: boolean;
  showPercent: boolean;
  showCatName: boolean;
  showSerName: boolean;
  pos?: string;
  style: TextStyle;
  formatCode?: string;
}
export interface Marker {
  symbol: string;
  size: number;
  fill?: string;
  stroke?: string;
}
export interface Series {
  index: number;
  name: string;
  categories: string[];
  values: (number | null)[];
  xValues?: (number | null)[];
  formatCode: string;
  fill?: string;
  stroke?: Stroke;
  marker: Marker | null;
  smooth: boolean;
  labels?: DataLabels;
  pointFills: Map<number, string>;
}
export type PlotType = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
export interface Plot {
  type: PlotType;
  horizontal: boolean;
  grouping: 'clustered' | 'stacked' | 'percentStacked' | 'standard';
  gapWidth: number;
  overlap: number;
  varyColors: boolean;
  holeSize: number;
  firstSliceAng: number;
  markers: boolean;
  axIds: string[];
  series: Series[];
}
export interface Axis {
  id: string;
  kind: 'cat' | 'val' | 'date' | 'ser';
  pos: string; // b | l | r | t
  deleted: boolean;
  title?: Label;
  min?: number;
  max?: number;
  majorUnit?: number;
  reversed: boolean;
  gridlines?: Stroke;
  line?: Stroke;
  labelStyle: TextStyle;
  labelsShown: boolean;
  formatCode?: string;
  sourceLinked: boolean;
  crossBetween: 'between' | 'midCat';
}
export interface ChartModel {
  title?: Label;
  plots: Plot[];
  axes: Map<string, Axis>;
  legend?: { pos: string; style: TextStyle; hidden: Set<number> };
  dataTable?: { horz: boolean; vert: boolean; outline: boolean; keys: boolean; stroke: Stroke; style: TextStyle };
  fill: string;
  border?: Stroke;
  plotFill?: string;
  font: string;
  /** The document's theme, for Excel's automatic series colors. */
  theme: OfficeTheme;
  /** Set for a chart kind that is not drawn (its name, as the file has it). */
  unsupported?: string;
}

const TEXT = '#595959';
const LIGHT_LINE: Stroke = { color: '#D9D9D9', width: 1 };

function textStyle(txPr: Element | undefined, theme: OfficeTheme, base: TextStyle): TextStyle {
  const p = path(txPr, 'p') ?? kid(txPr, 'p');
  const def = path(p, 'pPr', 'defRPr');
  return runStyle(def, theme, base);
}
function runStyle(rPr: Element | undefined, theme: OfficeTheme, base: TextStyle): TextStyle {
  if (!rPr) return base;
  const sz = num(rPr.getAttribute('sz'));
  const b = rPr.getAttribute('b');
  const i = rPr.getAttribute('i');
  const color = fillOf(rPr, theme);
  return {
    sizePt: sz ? sz / 100 : base.sizePt,
    bold: b === null ? base.bold : b === '1' || b === 'true',
    italic: i === null ? base.italic : i === '1' || i === 'true',
    color: color && color !== 'none' ? color : base.color,
  };
}

/** The text of a <c:tx> (rich text or a cell reference's cached value), with its style. */
function readTx(tx: Element | undefined, txPr: Element | undefined, theme: OfficeTheme, base: TextStyle): Label | undefined {
  if (!tx) return undefined;
  const rich = kid(tx, 'rich');
  if (rich) {
    const paras = kids(rich, 'p');
    const firstRun = paras.flatMap((p) => kids(p, 'r'))[0];
    let style = runStyle(path(paras[0], 'pPr', 'defRPr'), theme, textStyle(txPr, theme, base));
    style = runStyle(kid(firstRun, 'rPr'), theme, style);
    const text = paras.map((p) => kids(p, 'r').concat(kids(p, 'fld')).map((r) => kid(r, 't')?.textContent ?? '').join('')).join('\n');
    return { text, style };
  }
  const ref = kid(tx, 'strRef');
  const cached = ref ? stringsOf(kid(ref, 'strCache')).join(' ') : (kid(tx, 'v')?.textContent ?? '');
  return { text: cached, style: textStyle(txPr, theme, base) };
}

function stringsOf(cache: Element | undefined): string[] {
  if (!cache) return [];
  const count = num(val(cache, 'ptCount')) ?? 0;
  const out: string[] = new Array(count).fill('');
  for (const pt of kids(cache, 'pt')) {
    const i = num(pt.getAttribute('idx')) ?? 0;
    if (i < 10000) out[i] = kid(pt, 'v')?.textContent ?? '';
  }
  return out;
}
function numbersOf(cache: Element | undefined): { values: (number | null)[]; formatCode: string } {
  if (!cache) return { values: [], formatCode: 'General' };
  const count = num(val(cache, 'ptCount')) ?? 0;
  const values: (number | null)[] = new Array(Math.min(count, 10000)).fill(null);
  for (const pt of kids(cache, 'pt')) {
    const i = num(pt.getAttribute('idx')) ?? 0;
    const v = num(kid(pt, 'v')?.textContent);
    if (i < 10000 && v !== undefined) values[i] = v;
  }
  return { values, formatCode: kid(cache, 'formatCode')?.textContent || 'General' };
}

/** Category labels from <c:cat> (or <c:xVal>): text, numbers or a multi-level reference (its innermost level). */
function categoriesOf(cat: Element | undefined): { labels: string[]; numbers?: (number | null)[] } {
  if (!cat) return { labels: [] };
  const strCache = path(cat, 'strRef', 'strCache') ?? kid(cat, 'strLit');
  if (strCache) return { labels: stringsOf(strCache) };
  const multi = path(cat, 'multiLvlStrRef', 'multiLvlStrCache');
  if (multi) {
    const count = num(val(multi, 'ptCount')) ?? 0;
    const lvl = kid(multi, 'lvl');
    const out: string[] = new Array(count).fill('');
    for (const pt of kids(lvl, 'pt')) out[num(pt.getAttribute('idx')) ?? 0] = kid(pt, 'v')?.textContent ?? '';
    return { labels: out };
  }
  const numCache = path(cat, 'numRef', 'numCache') ?? kid(cat, 'numLit');
  if (numCache) {
    const { values, formatCode } = numbersOf(numCache);
    return { labels: values.map((v) => (v === null ? '' : formatNumber(v, formatCode))), numbers: values };
  }
  return { labels: [] };
}

const PLOT_KINDS: Record<string, { type: PlotType; horizontal?: boolean }> = {
  barChart: { type: 'bar' }, bar3DChart: { type: 'bar' }, lineChart: { type: 'line' }, line3DChart: { type: 'line' },
  areaChart: { type: 'area' }, area3DChart: { type: 'area' }, pieChart: { type: 'pie' }, pie3DChart: { type: 'pie' },
  doughnutChart: { type: 'doughnut' }, scatterChart: { type: 'scatter' },
};
const UNSUPPORTED_KINDS: Record<string, string> = {
  radarChart: 'radar', bubbleChart: 'bubble', stockChart: 'stock', surfaceChart: 'surface', surface3DChart: 'surface', ofPieChart: 'pie of pie',
};

/** Excel's automatic series colors: the six accents, then darker, then lighter rounds of them. */
export function autoColor(index: number, theme: OfficeTheme): string {
  const accent = theme.colors[`accent${(index % 6) + 1}`];
  const round = Math.floor(index / 6) % 4;
  let rgb = toRgb(accent);
  if (round === 1) rgb = hslToRgb(((h) => [h[0], h[1], h[2] * 0.6])(rgbToHsl(rgb)) as Rgb);
  if (round === 2) rgb = hslToRgb(((h) => [h[0], h[1], h[2] * 0.8 + 0.2])(rgbToHsl(rgb)) as Rgb);
  if (round === 3) rgb = hslToRgb(((h) => [h[0], h[1], h[2] * 0.8])(rgbToHsl(rgb)) as Rgb);
  return `#${toHex(rgb)}`;
}

function readLabels(dLbls: Element | undefined, theme: OfficeTheme, base: TextStyle, inherited?: DataLabels): DataLabels | undefined {
  if (!dLbls) return inherited;
  if (on(dLbls, 'delete')) return undefined;
  const numFmt = kid(dLbls, 'numFmt');
  return {
    showVal: kid(dLbls, 'showVal') ? on(dLbls, 'showVal') : (inherited?.showVal ?? false),
    showPercent: kid(dLbls, 'showPercent') ? on(dLbls, 'showPercent') : (inherited?.showPercent ?? false),
    showCatName: kid(dLbls, 'showCatName') ? on(dLbls, 'showCatName') : (inherited?.showCatName ?? false),
    showSerName: kid(dLbls, 'showSerName') ? on(dLbls, 'showSerName') : (inherited?.showSerName ?? false),
    pos: val(dLbls, 'dLblPos') ?? inherited?.pos,
    style: textStyle(kid(dLbls, 'txPr'), theme, inherited?.style ?? base),
    formatCode: numFmt && numFmt.getAttribute('sourceLinked') !== '1' ? (numFmt.getAttribute('formatCode') ?? undefined) : inherited?.formatCode,
  };
}

/** A chart part (the XML of chartN.xml) as a model, with colors resolved against the document's theme. */
export function parseChart(xml: string, theme: OfficeTheme = DEFAULT_THEME): ChartModel {
  const doc = parseXml(xml);
  const space = doc.documentElement;
  const chart = kid(space, 'chart');
  const font = theme.minorFont;
  // Office's defaults are 9pt text, 10pt axis titles and a 14pt chart title; a chart-wide size (PowerPoint's are
  // 18pt) scales the titles with it.
  const baseText = textStyle(kid(space, 'txPr'), theme, { sizePt: 9, color: TEXT, bold: false, italic: false });
  const spaceFill = fillOf(kid(space, 'spPr'), theme);
  const model: ChartModel = {
    plots: [],
    axes: new Map(),
    fill: spaceFill ?? '#FFFFFF',
    border: strokeOf(kid(space, 'spPr'), theme),
    font,
    theme,
  };
  if (!chart) {
    model.unsupported = 'chart';
    return model;
  }
  const plotArea = kid(chart, 'plotArea');
  const pf = fillOf(kid(plotArea, 'spPr'), theme);
  model.plotFill = pf && pf !== 'none' ? pf : undefined;

  for (const el of plotArea?.children ?? []) {
    const name = el.localName;
    if (UNSUPPORTED_KINDS[name]) {
      model.unsupported ??= UNSUPPORTED_KINDS[name];
      continue;
    }
    const kind = PLOT_KINDS[name];
    if (!kind) continue;
    const groupLabels = readLabels(kid(el, 'dLbls'), theme, { ...baseText, color: '#404040' });
    const grouping = (val(el, 'grouping') ?? (kind.type === 'bar' ? 'clustered' : 'standard')) as Plot['grouping'];
    const plot: Plot = {
      type: kind.type,
      horizontal: kind.type === 'bar' && val(el, 'barDir') === 'bar',
      grouping,
      gapWidth: num(val(el, 'gapWidth')) ?? 150,
      overlap: num(val(el, 'overlap')) ?? (grouping === 'stacked' || grouping === 'percentStacked' ? 100 : 0),
      varyColors: on(el, 'varyColors', kind.type === 'pie' || kind.type === 'doughnut'),
      holeSize: num(val(el, 'holeSize')) ?? 50,
      firstSliceAng: num(val(el, 'firstSliceAng')) ?? 0,
      markers: name === 'lineChart' ? on(el, 'marker', false) : kind.type === 'scatter',
      axIds: kids(el, 'axId').map((a) => a.getAttribute('val') ?? ''),
      series: [],
    };
    const scatterStyle = val(el, 'scatterStyle') ?? 'marker';
    for (const ser of kids(el, 'ser')) {
      const index = num(val(ser, 'idx')) ?? plot.series.length;
      const spPr = kid(ser, 'spPr');
      const values = numbersOf(path(ser, 'val', 'numRef', 'numCache') ?? path(ser, 'val', 'numLit') ?? path(ser, 'yVal', 'numRef', 'numCache') ?? path(ser, 'yVal', 'numLit'));
      const cats = categoriesOf(kid(ser, 'cat') ?? kid(ser, 'xVal'));
      const markerEl = kid(ser, 'marker');
      const symbol = val(markerEl, 'symbol') ?? (plot.markers ? 'auto' : 'none');
      const lineLike = kind.type === 'line' || kind.type === 'scatter';
      let stroke = strokeOf(spPr, theme);
      if (lineLike && kind.type === 'scatter' && !kid(spPr, 'ln') && (scatterStyle === 'marker' || scatterStyle === 'none')) stroke = { color: 'none', width: 0 };
      const pointFills = new Map<number, string>();
      for (const dPt of kids(ser, 'dPt')) {
        const f = fillOf(kid(dPt, 'spPr'), theme);
        if (f) pointFills.set(num(val(dPt, 'idx')) ?? 0, f);
      }
      plot.series.push({
        index,
        name: readTx(kid(ser, 'tx'), undefined, theme, baseText)?.text ?? `Series${index + 1}`,
        categories: cats.labels,
        values: values.values,
        xValues: kind.type === 'scatter' ? (cats.numbers ?? cats.labels.map((_, i) => i + 1)) : undefined,
        formatCode: values.formatCode,
        fill: fillOf(spPr, theme),
        stroke,
        marker:
          symbol === 'none'
            ? null
            : {
                symbol,
                size: num(val(markerEl, 'size')) ?? 5,
                fill: fillOf(kid(markerEl, 'spPr'), theme),
                stroke: strokeOf(kid(markerEl, 'spPr'), theme)?.color,
              },
        smooth: on(ser, 'smooth', false),
        labels: readLabels(kid(ser, 'dLbls'), theme, groupLabels?.style ?? { ...baseText, color: '#404040' }, groupLabels),
        pointFills,
      });
    }
    model.plots.push(plot);
  }
  if (!model.plots.length && !model.unsupported) {
    const other = [...(plotArea?.children ?? [])].find((c) => c.localName.endsWith('Chart'));
    model.unsupported = other ? other.localName.replace(/Chart$/, '') : 'empty';
  }

  for (const el of plotArea?.children ?? []) {
    const kind = { catAx: 'cat', valAx: 'val', dateAx: 'date', serAx: 'ser' }[el.localName] as Axis['kind'] | undefined;
    if (!kind) continue;
    const scaling = kid(el, 'scaling');
    const numFmt = kid(el, 'numFmt');
    const id = val(el, 'axId') ?? '';
    model.axes.set(id, {
      id,
      kind,
      pos: val(el, 'axPos') ?? (kind === 'val' ? 'l' : 'b'),
      deleted: on(el, 'delete'),
      title: kid(el, 'title') ? readTx(path(el, 'title', 'tx'), path(el, 'title', 'txPr'), theme, { ...baseText, sizePt: (baseText.sizePt * 10) / 9 }) : undefined,
      min: num(val(scaling, 'min')),
      max: num(val(scaling, 'max')),
      majorUnit: num(val(el, 'majorUnit')),
      reversed: val(scaling, 'orientation') === 'maxMin',
      gridlines: kid(el, 'majorGridlines') ? (strokeOf(path(el, 'majorGridlines', 'spPr'), theme) ?? LIGHT_LINE) : undefined,
      line: strokeOf(kid(el, 'spPr'), theme) ?? (kind === 'val' ? undefined : LIGHT_LINE),
      labelStyle: textStyle(kid(el, 'txPr'), theme, baseText),
      labelsShown: val(el, 'tickLblPos') !== 'none',
      formatCode: numFmt?.getAttribute('formatCode') ?? undefined,
      sourceLinked: numFmt?.getAttribute('sourceLinked') === '1',
      crossBetween: val(el, 'crossBetween') === 'midCat' ? 'midCat' : 'between',
    });
  }

  // Title: the file's text, or Excel's automatic one (the series name) when the chart has a single series.
  const titleEl = kid(chart, 'title');
  const allSeries = model.plots.flatMap((p) => p.series);
  if (titleEl) {
    const titleBase: TextStyle = { ...baseText, sizePt: (baseText.sizePt * 14) / 9 };
    model.title = readTx(kid(titleEl, 'tx'), kid(titleEl, 'txPr'), theme, titleBase) ?? (allSeries.length === 1 ? { text: allSeries[0].name, style: textStyle(kid(titleEl, 'txPr'), theme, titleBase) } : { text: 'Chart Title', style: textStyle(kid(titleEl, 'txPr'), theme, titleBase) });
  } else if (!on(chart, 'autoTitleDeleted') && allSeries.length === 1 && allSeries[0].name) {
    model.title = { text: allSeries[0].name, style: { ...baseText, sizePt: (baseText.sizePt * 14) / 9 } };
  }

  const legend = kid(chart, 'legend');
  if (legend)
    model.legend = {
      pos: val(legend, 'legendPos') ?? 'r',
      style: textStyle(kid(legend, 'txPr'), theme, baseText),
      hidden: new Set(kids(legend, 'legendEntry').filter((e) => on(e, 'delete')).map((e) => num(val(e, 'idx')) ?? -1)),
    };
  const table = kid(plotArea, 'dTable');
  if (table)
    model.dataTable = {
      horz: on(table, 'showHorzBorder'),
      vert: on(table, 'showVertBorder'),
      outline: on(table, 'showOutline'),
      keys: on(table, 'showKeys'),
      stroke: strokeOf(kid(table, 'spPr'), theme) ?? LIGHT_LINE,
      style: textStyle(kid(table, 'txPr'), theme, baseText),
    };
  return model;
}

// --- drawing --------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const px = (pt: number) => (pt * 96) / 72;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Text width, estimated (an SVG shown as an image cannot be measured): about half an em per character. */
export function textWidth(s: string, style: TextStyle): number {
  let w = 0;
  for (const ch of s) w += /[ il.,:;'|!]/.test(ch) ? 0.28 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9]/.test(ch) ? 0.6 : 0.52;
  return w * px(style.sizePt) * (style.bold ? 1.06 : 1);
}
const lineHeight = (style: TextStyle) => px(style.sizePt) * 1.25;

/** Axis bounds and step the way Excel picks them: zero included unless the data sit high above it, 5% headroom. */
export function niceScale(lo: number, hi: number, maxTicks: number, fixed: { min?: number; max?: number; unit?: number } = {}, pad = true): { min: number; max: number; step: number } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo >= 0 && (hi === 0 || (hi - lo) / hi > 1 / 6)) lo = 0;
  if (hi <= 0 && (lo === 0 || (lo - hi) / lo > 1 / 6)) hi = 0;
  if (fixed.min !== undefined) lo = fixed.min;
  if (fixed.max !== undefined) hi = fixed.max;
  if (hi === lo) hi = lo === 0 ? 1 : lo + Math.abs(lo) * 0.1;
  const range = hi - lo;
  const top = fixed.max === undefined && pad && hi > 0 ? hi + range * 0.05 : hi;
  const bottom = fixed.min === undefined && pad && lo < 0 ? lo - range * 0.05 : lo;
  let step = fixed.unit && fixed.unit > 0 ? fixed.unit : 0;
  if (!step) {
    const ticks = Math.max(2, maxTicks);
    const rough = (top - bottom) / ticks;
    const mag = 10 ** Math.floor(Math.log10(rough));
    step = [1, 2, 5, 10, 20].map((m) => m * mag).find((s) => Math.ceil(top / s - 1e-9) - Math.floor(bottom / s + 1e-9) <= ticks) ?? 10 * mag;
  }
  const clean = (n: number) => Number(n.toPrecision(12));
  return {
    min: fixed.min !== undefined ? fixed.min : clean(Math.floor(bottom / step + 1e-9) * step),
    max: fixed.max !== undefined ? fixed.max : clean(Math.ceil(top / step - 1e-9) * step),
    step,
  };
}

function ticksOf(scale: { min: number; max: number; step: number }): number[] {
  const out: number[] = [];
  for (let v = scale.min, i = 0; v <= scale.max + scale.step * 1e-6 && i < 200; v = scale.min + ++i * scale.step) out.push(Number(v.toPrecision(12)));
  return out;
}

class Svg {
  parts: string[] = [];
  constructor(private font: string) {}
  rect(x: number, y: number, w: number, h: number, fill: string, stroke?: Stroke) {
    if (w <= 0 || h <= 0) return;
    this.parts.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="${esc(fill)}"${this.strokeAttrs(stroke)}/>`);
  }
  line(x1: number, y1: number, x2: number, y2: number, stroke: Stroke) {
    if (stroke.color === 'none') return;
    this.parts.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"${this.strokeAttrs(stroke)}/>`);
  }
  path(d: string, fill: string, stroke?: Stroke, extra = '') {
    this.parts.push(`<path d="${d}" fill="${esc(fill)}"${this.strokeAttrs(stroke)}${extra}/>`);
  }
  strokeAttrs(s?: Stroke) {
    if (!s || s.color === 'none' || s.width <= 0) return '';
    return ` stroke="${esc(s.color)}" stroke-width="${r2(s.width)}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"`;
  }
  text(x: number, y: number, s: string, style: TextStyle, anchor: 'start' | 'middle' | 'end' = 'middle', rotate = 0) {
    if (!s) return;
    const size = px(style.sizePt);
    const transform = rotate ? ` transform="rotate(${rotate} ${r2(x)} ${r2(y)})"` : '';
    this.parts.push(
      `<text x="${r2(x)}" y="${r2(y + size * 0.35)}" font-size="${r2(size)}" fill="${esc(style.color)}" text-anchor="${anchor}"${style.bold ? ' font-weight="700"' : ''}${style.italic ? ' font-style="italic"' : ''}${transform}>${esc(s)}</text>`,
    );
  }
  done(w: number, h: number) {
    const family = `'${this.font.replace(/['"<>&]/g, '')}', Aptos, Calibri, Carlito, 'Helvetica Neue', Arial, sans-serif`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}" font-family="${esc(family)}">${this.parts.join('')}</svg>`;
  }
}

/** Split text into lines that fit `width` (by words; a single long word stays whole). */
function wrap(text: string, style: TextStyle, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, style) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

interface LegendItem {
  label: string;
  fill?: string;
  stroke?: Stroke;
  marker?: Marker | null;
  line: boolean;
}

function seriesFill(s: Series, plot: Plot, theme: OfficeTheme, point?: number): string {
  if (point !== undefined) {
    const own = s.pointFills.get(point);
    if (own) return own;
    if (plot.varyColors) return autoColor(point, theme);
  }
  return s.fill && s.fill !== 'none' ? s.fill : s.fill === 'none' ? 'none' : autoColor(s.index, theme);
}
function seriesStroke(s: Series, theme: OfficeTheme): Stroke {
  const auto = autoColor(s.index, theme);
  const st = s.stroke;
  if (!st) return { color: auto, width: 3 };
  return { ...st, color: st.color === 'auto' ? auto : st.color, width: st.width || 3 };
}

function drawMarker(svg: Svg, x: number, y: number, m: Marker, color: string) {
  const r = Math.max(2, m.size * 0.65);
  const fill = m.fill && m.fill !== 'auto' ? m.fill : color;
  const stroke: Stroke = { color: m.stroke && m.stroke !== 'auto' ? m.stroke : color, width: 1 };
  switch (m.symbol) {
    case 'square':
      return svg.rect(x - r, y - r, 2 * r, 2 * r, fill, stroke);
    case 'diamond':
      return svg.path(`M${r2(x)} ${r2(y - r)}L${r2(x + r)} ${r2(y)}L${r2(x)} ${r2(y + r)}L${r2(x - r)} ${r2(y)}Z`, fill, stroke);
    case 'triangle':
      return svg.path(`M${r2(x)} ${r2(y - r)}L${r2(x + r)} ${r2(y + r)}L${r2(x - r)} ${r2(y + r)}Z`, fill, stroke);
    case 'x':
    case 'star':
    case 'plus':
      svg.line(x - r, y - r, x + r, y + r, stroke);
      return svg.line(x - r, y + r, x + r, y - r, stroke);
    case 'dash':
      return svg.line(x - r, y, x + r, y, { ...stroke, width: 2 });
    default:
      svg.parts.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}" fill="${esc(fill)}"${svg.strokeAttrs(stroke)}/>`);
  }
}

function labelText(s: Series, i: number, v: number, total: number, opts: DataLabels): string {
  const parts: string[] = [];
  if (opts.showSerName) parts.push(s.name);
  if (opts.showCatName) parts.push(s.categories[i] ?? '');
  if (opts.showVal) parts.push(formatNumber(v, opts.formatCode ?? s.formatCode));
  if (opts.showPercent) parts.push(total ? formatNumber(v / total, '0%') : '');
  return parts.filter(Boolean).join(', ');
}

function smoothPath(points: [number, number][]): string {
  if (points.length < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join('');
  let d = `M${r2(points[0][0])} ${r2(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return d;
}

/** The chart as an SVG document, `width` x `height` px. */
export function renderChartSvg(model: ChartModel, width: number, height: number): string {
  const theme = model.theme;
  const W = Math.max(40, width);
  const H = Math.max(30, height);
  const svg = new Svg(model.font);
  svg.rect(0.5, 0.5, W - 1, H - 1, model.fill === 'none' ? 'none' : model.fill, model.border && model.border.color !== 'none' ? { ...model.border, color: model.border.color === 'auto' ? '#D9D9D9' : model.border.color } : model.border ? undefined : { color: '#D9D9D9', width: 1 });
  const pad = 9;
  let top = pad;
  let bottom = H - pad;
  let left = pad;
  let right = W - pad;

  if (model.title?.text) {
    const lines = wrap(model.title.text, model.title.style, W - 2 * pad);
    const lh = lineHeight(model.title.style);
    lines.forEach((l, i) => svg.text(W / 2, top + lh * (i + 0.5), l, model.title!.style));
    top += lines.length * lh + 8;
  }

  if (model.unsupported) {
    const style: TextStyle = { sizePt: 10, color: '#7F7F7F', bold: false, italic: false };
    svg.text(W / 2, (top + bottom) / 2, t("This chart can't be previewed."), style);
    return svg.done(W, H);
  }

  const pieLike = model.plots[0]?.type === 'pie' || model.plots[0]?.type === 'doughnut';
  const cartesian = model.plots.filter((p) => p.type !== 'pie' && p.type !== 'doughnut');

  // Legend entries: the series, or a pie's slices.
  const items: LegendItem[] = [];
  if (pieLike) {
    const plot = model.plots[0];
    const s = plot.series[0];
    s?.values.forEach((_, i) => {
      if (!model.legend?.hidden.has(i)) items.push({ label: s.categories[i] ?? String(i + 1), fill: seriesFill(s, plot, theme, i), line: false });
    });
  } else
    for (const plot of model.plots)
      for (const s of plot.series) {
        if (model.legend?.hidden.has(s.index)) continue;
        const line = plot.type === 'line' || plot.type === 'scatter';
        items.push({ label: s.name, fill: line ? undefined : seriesFill(s, plot, theme), stroke: line ? seriesStroke(s, theme) : undefined, marker: line ? s.marker : undefined, line });
      }

  const legend = model.legend;
  const keyW = 22;
  if (legend && items.length) {
    const st = legend.style;
    const lh = lineHeight(st) + 4;
    const itemW = (it: LegendItem) => keyW + 5 + textWidth(it.label, st) + 14;
    if (legend.pos === 'b' || legend.pos === 't') {
      const rows: LegendItem[][] = [[]];
      let rowW = 0;
      for (const it of items) {
        const w = itemW(it);
        if (rowW + w > right - left && rows[rows.length - 1].length) {
          rows.push([]);
          rowW = 0;
        }
        rows[rows.length - 1].push(it);
        rowW += w;
      }
      const h = rows.length * lh;
      const y0 = legend.pos === 'b' ? bottom - h : top;
      rows.forEach((row, ri) => {
        const total = row.reduce((a, it) => a + itemW(it), 0) - 14;
        let x = (W - total) / 2;
        for (const it of row) {
          drawKey(svg, x, y0 + lh * (ri + 0.5), it);
          svg.text(x + keyW + 5, y0 + lh * (ri + 0.5), it.label, st, 'start');
          x += itemW(it);
        }
      });
      if (legend.pos === 'b') bottom -= h + 6;
      else top += h + 6;
    } else {
      const colW = Math.min((right - left) * 0.4, Math.max(...items.map((it) => itemW(it) - 14)));
      const h = items.length * lh;
      const x0 = legend.pos === 'l' ? left : right - colW;
      const y0 = legend.pos === 'tr' ? top : Math.max(top, (top + bottom - h) / 2);
      items.forEach((it, i) => {
        drawKey(svg, x0, y0 + lh * (i + 0.5), it);
        svg.text(x0 + keyW + 5, y0 + lh * (i + 0.5), it.label, st, 'start');
      });
      if (legend.pos === 'l') left += colW + 10;
      else right -= colW + 10;
    }
  }

  if (pieLike) {
    drawPie(svg, model.plots[0], theme, left, top, right, bottom);
    return svg.done(W, H);
  }
  if (!cartesian.length) return svg.done(W, H);

  // Axes: a category axis, and one or two value axes (the second on the right).
  const axisOf = (id: string) => model.axes.get(id);
  const first = cartesian[0];
  const horizontal = first.horizontal;
  const scatter = first.type === 'scatter';
  const catAxis = axisOf(first.axIds[0]);
  const primaryVal = axisOf(first.axIds[1]);
  const valIds = [...new Set(cartesian.map((p) => p.axIds[1]))];
  const secondaryId = valIds.find((id) => id !== first.axIds[1]);
  const secondaryVal = secondaryId ? axisOf(secondaryId) : undefined;
  const nCats = Math.max(1, ...cartesian.flatMap((p) => p.series.map((s) => Math.max(s.values.length, s.categories.length))));
  const categories = Array.from({ length: nCats }, (_, i) => cartesian.flatMap((p) => p.series).find((s) => s.categories[i])?.categories[i] ?? String(i + 1));
  const valStyle = primaryVal?.labelStyle ?? { sizePt: 9, color: TEXT, bold: false, italic: false };
  const catStyle = catAxis?.labelStyle ?? valStyle;

  // Value ranges per value axis (stacked groups add up).
  const ranges = new Map<string, { lo: number; hi: number; percent: boolean }>();
  for (const p of cartesian) {
    const id = p.axIds[1];
    const r = ranges.get(id) ?? { lo: Infinity, hi: -Infinity, percent: false };
    if (p.grouping === 'stacked' || p.grouping === 'percentStacked') {
      for (let i = 0; i < nCats; i++) {
        let pos = 0;
        let neg = 0;
        const total = p.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0) || 1;
        for (const s of p.series) {
          const v = (s.values[i] ?? 0) / (p.grouping === 'percentStacked' ? total : 1);
          if (v >= 0) pos += v;
          else neg += v;
        }
        r.lo = Math.min(r.lo, neg);
        r.hi = Math.max(r.hi, pos);
      }
      r.percent ||= p.grouping === 'percentStacked';
    } else
      for (const s of p.series)
        for (const v of s.values)
          if (v !== null) {
            r.lo = Math.min(r.lo, v);
            r.hi = Math.max(r.hi, v);
          }
    if (p.type === 'bar' || p.type === 'area') {
      r.lo = Math.min(r.lo, 0);
      r.hi = Math.max(r.hi, 0);
    }
    ranges.set(id, r);
  }

  // Vertical space: axis titles, category labels or the data table.
  const catTitleH = catAxis?.title?.text && !catAxis.deleted ? lineHeight(catAxis.title.style) + 6 : 0;
  const valTitleW = primaryVal?.title?.text && !primaryVal.deleted ? lineHeight(primaryVal.title.style) + 6 : 0;
  const secTitleW = secondaryVal?.title?.text && !secondaryVal.deleted ? lineHeight(secondaryVal.title.style) + 6 : 0;
  const table = !horizontal && !scatter ? model.dataTable : undefined;
  const tableSeries = table ? cartesian.flatMap((p) => p.series.map((s) => ({ s, p }))) : [];
  const rowH = table ? lineHeight(table.style) + 7 : 0;
  const tableKeyW = table ? Math.max(...tableSeries.map(({ s }) => textWidth(s.name, table.style))) + (table.keys ? keyW + 14 : 10) : 0;
  const catShown = !!catAxis && !catAxis.deleted && catAxis.labelsShown;
  const valShown = !!primaryVal && !primaryVal.deleted && primaryVal.labelsShown;

  // Horizontal value axis (bars) or a category axis along the bottom.
  const bottomLabelH = table ? rowH * (tableSeries.length + 1) : horizontal ? (valShown ? lineHeight(valStyle) + 4 : 0) : catShown ? lineHeight(catStyle) + 4 : 0;
  const plotTop = top + 4;
  let plotBottom = bottom - catTitleH - bottomLabelH;
  const plotH0 = Math.max(10, plotBottom - plotTop);

  const tickCount = (len: number, style: TextStyle) => Math.max(2, Math.min(10, Math.floor(len / (lineHeight(style) * 2.4))));
  const scaleFor = (id: string | undefined, length: number) => {
    const axis = id ? axisOf(id) : undefined;
    const r = id ? ranges.get(id) : undefined;
    if (!r || !Number.isFinite(r.lo)) return niceScale(0, 1, 5);
    if (r.percent) return niceScale(Math.min(0, r.lo), Math.max(0, r.hi), tickCount(length, valStyle), { min: axis?.min ?? (r.lo < 0 ? undefined : 0), max: axis?.max ?? (r.hi > 0 ? 1 : undefined), unit: axis?.majorUnit }, false);
    return niceScale(r.lo, r.hi, tickCount(length, valStyle), { min: axis?.min, max: axis?.max, unit: axis?.majorUnit });
  };
  const valFormat = (axis: Axis | undefined, p?: Plot) => {
    if (p?.grouping === 'percentStacked') return '0%';
    if (axis?.formatCode && !(axis.sourceLinked && /general/i.test(axis.formatCode))) return axis.formatCode;
    return p?.series[0]?.formatCode ?? 'General';
  };
  const primaryPlot = cartesian.find((p) => p.axIds[1] === first.axIds[1]);
  const secondaryPlot = cartesian.find((p) => p.axIds[1] === secondaryId);

  // Scatter: the x axis is a value axis too.
  let xScale: { min: number; max: number; step: number } | undefined;
  if (scatter) {
    const xs = cartesian.flatMap((p) => p.series.flatMap((s) => (s.xValues ?? []).filter((v): v is number => v !== null)));
    xScale = niceScale(Math.min(...xs), Math.max(...xs), tickCount(right - left, catStyle), { min: catAxis?.min, max: catAxis?.max, unit: catAxis?.majorUnit });
  }

  let plotLeft: number;
  let plotRight: number;
  let primary: { min: number; max: number; step: number };
  let secondary: { min: number; max: number; step: number } | undefined;
  if (!horizontal) {
    primary = scaleFor(first.axIds[1], plotH0);
    secondary = secondaryId ? scaleFor(secondaryId, plotH0) : undefined;
    const fmtP = valFormat(primaryVal, primaryPlot);
    const labelW = valShown ? Math.max(...ticksOf(primary).map((t) => textWidth(formatNumber(t, fmtP), valStyle))) + 7 : 0;
    const secShown = secondaryVal && !secondaryVal.deleted && secondaryVal.labelsShown;
    const secW = secondary && secShown ? Math.max(...ticksOf(secondary).map((t) => textWidth(formatNumber(t, valFormat(secondaryVal, secondaryPlot)), secondaryVal!.labelStyle))) + 7 : 0;
    plotLeft = left + Math.max(valTitleW + labelW, tableKeyW);
    plotRight = right - Math.max(secW + secTitleW, 6);
  } else {
    const catLabelW = catShown ? Math.min((right - left) * 0.4, Math.max(...categories.map((c) => textWidth(c, catStyle)))) + 7 : 0;
    plotLeft = left + valTitleW + catLabelW;
    plotRight = right - 8;
    primary = scaleFor(first.axIds[1], plotRight - plotLeft);
    secondary = secondaryId ? scaleFor(secondaryId, plotRight - plotLeft) : undefined;
  }
  const plotW = Math.max(10, plotRight - plotLeft);

  // Category labels that do not fit side by side are turned 45 degrees (and the plot made shorter for them).
  const band = (horizontal ? plotH0 : plotW) / nCats;
  let rotateCats = false;
  if (!horizontal && !scatter && catShown && !table) {
    const widest = Math.max(...categories.map((c) => textWidth(c, catStyle)));
    if (widest > band * 0.95) {
      rotateCats = true;
      const extra = Math.min(widest * 0.71, (bottom - top) * 0.35) - lineHeight(catStyle) * 0.3;
      plotBottom -= Math.max(0, extra);
      primary = scaleFor(first.axIds[1], plotBottom - plotTop);
      secondary = secondaryId ? scaleFor(secondaryId, plotBottom - plotTop) : undefined;
    }
  }
  const plotH = Math.max(10, plotBottom - plotTop);

  if (model.plotFill) svg.rect(plotLeft, plotTop, plotW, plotH, model.plotFill);

  // value -> pixel along the value axis; category index -> band start along the category axis
  const valPos = (v: number, s: { min: number; max: number }, reversed = false) => {
    const f = (v - s.min) / (s.max - s.min || 1);
    const g = reversed ? 1 - f : f;
    return horizontal ? plotLeft + g * plotW : plotBottom - g * plotH;
  };
  const catReversed = catAxis?.reversed ?? false;
  const bandLen = (horizontal ? plotH : plotW) / nCats;
  const bandStart = (i: number) => {
    const k = catReversed !== horizontal ? nCats - 1 - i : i; // bars: first category at the bottom, as Excel draws it
    return (horizontal ? plotTop : plotLeft) + k * bandLen;
  };
  const midCat = cartesian.every((p) => p.type !== 'bar') && catAxis && axisOf(first.axIds[1])?.crossBetween === 'midCat';
  const catCenter = (i: number) => (midCat && nCats > 1 ? (horizontal ? plotTop : plotLeft) + ((catReversed ? nCats - 1 - i : i) * (horizontal ? plotH : plotW)) / (nCats - 1) : bandStart(i) + bandLen / 2);
  const xPos = (x: number) => plotLeft + ((x - xScale!.min) / (xScale!.max - xScale!.min || 1)) * plotW;

  // Gridlines and value labels.
  const scaleOf = (p: Plot) => (p.axIds[1] === secondaryId && secondary ? secondary : primary);
  const reversedOf = (p: Plot) => axisOf(p.axIds[1])?.reversed ?? false;
  if (primaryVal?.gridlines)
    for (const t of ticksOf(primary)) {
      const pos = valPos(t, primary, primaryVal.reversed);
      if (horizontal) svg.line(pos, plotTop, pos, plotBottom, primaryVal.gridlines);
      else svg.line(plotLeft, pos, plotRight, pos, primaryVal.gridlines);
    }
  if (scatter && catAxis?.gridlines && xScale) for (const t of ticksOf(xScale)) svg.line(xPos(t), plotTop, xPos(t), plotBottom, catAxis.gridlines);
  if (valShown) {
    const fmt = valFormat(primaryVal, primaryPlot);
    for (const t of ticksOf(primary)) {
      const pos = valPos(t, primary, primaryVal!.reversed);
      if (horizontal) svg.text(pos, plotBottom + 4 + lineHeight(valStyle) / 2, formatNumber(t, fmt), valStyle);
      else svg.text(plotLeft - 5, pos, formatNumber(t, fmt), valStyle, 'end');
    }
  }
  if (secondary && secondaryVal && !secondaryVal.deleted && secondaryVal.labelsShown && !horizontal) {
    const fmt = valFormat(secondaryVal, secondaryPlot);
    for (const t of ticksOf(secondary)) svg.text(plotRight + 5, valPos(t, secondary, secondaryVal.reversed), formatNumber(t, fmt), secondaryVal.labelStyle, 'start');
  }
  if (primaryVal?.line && !primaryVal.deleted) {
    if (horizontal) svg.line(plotLeft, plotBottom, plotRight, plotBottom, primaryVal.line);
    else svg.line(plotLeft, plotTop, plotLeft, plotBottom, primaryVal.line);
  }

  // Axis titles.
  if (valTitleW && primaryVal?.title) {
    if (horizontal) svg.text((plotLeft + plotRight) / 2, bottom - catTitleH / 2, primaryVal.title.text, primaryVal.title.style);
    else svg.text(left + valTitleW / 2, (plotTop + plotBottom) / 2, primaryVal.title.text, primaryVal.title.style, 'middle', -90);
  }
  if (secTitleW && secondaryVal?.title) svg.text(right - secTitleW / 2, (plotTop + plotBottom) / 2, secondaryVal.title.text, secondaryVal.title.style, 'middle', 90);
  if (catTitleH && catAxis?.title) {
    if (horizontal) svg.text(left + lineHeight(catAxis.title.style) / 2 + 2, (plotTop + plotBottom) / 2, catAxis.title.text, catAxis.title.style, 'middle', -90);
    else svg.text((plotLeft + plotRight) / 2, bottom - catTitleH / 2 + 2, catAxis.title.text, catAxis.title.style);
  }

  // Series, with data labels drawn last so bars do not cover them.
  const labels: (() => void)[] = [];
  for (const plot of cartesian) {
    const sc = scaleOf(plot);
    const rev = reversedOf(plot);
    const stacked = plot.grouping === 'stacked' || plot.grouping === 'percentStacked';
    const totals = Array.from({ length: nCats }, (_, i) => plot.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0) || 1);
    const norm = (v: number, i: number) => (plot.grouping === 'percentStacked' ? v / totals[i] : v);

    if (plot.type === 'bar') {
      const n = stacked ? 1 : plot.series.length;
      const ov = stacked ? 1 : plot.overlap / 100;
      const gap = plot.gapWidth / 100;
      const barW = bandLen / (n - (n - 1) * ov + gap);
      const pos = new Array(nCats).fill(0);
      const neg = new Array(nCats).fill(0);
      plot.series.forEach((s, si) => {
        for (let i = 0; i < nCats; i++) {
          const raw = s.values[i];
          if (raw === null || raw === undefined) continue;
          const v = norm(raw, i);
          let from = 0;
          let to = v;
          if (stacked) {
            from = v >= 0 ? pos[i] : neg[i];
            to = from + v;
            if (v >= 0) pos[i] = to;
            else neg[i] = to;
          }
          const a = valPos(from, sc, rev);
          const b = valPos(to, sc, rev);
          const k = stacked ? 0 : si;
          const offset = bandStart(i) + (gap * barW) / 2 + k * barW * (1 - ov);
          const fill = seriesFill(s, plot, theme, plot.varyColors && plot.series.length === 1 ? i : undefined);
          const outline = s.stroke && s.stroke.color !== 'none' && s.stroke.color !== 'auto' ? s.stroke : undefined;
          if (horizontal) svg.rect(Math.min(a, b), offset, Math.abs(b - a), barW, fill, outline);
          else svg.rect(offset, Math.min(a, b), barW, Math.abs(b - a), fill, outline);
          const opts = s.labels;
          if (opts && (opts.showVal || opts.showCatName || opts.showSerName || opts.showPercent)) {
            const text = labelText(s, i, raw, totals[i], opts);
            const where = opts.pos ?? (stacked ? 'ctr' : 'outEnd');
            const up = v >= 0 !== rev;
            labels.push(() => {
              const st = opts.style;
              const mid = offset + barW / 2;
              const lh = lineHeight(st);
              if (horizontal) {
                const x = where === 'ctr' ? (a + b) / 2 : where === 'inEnd' ? b - (up ? 4 : -4) : where === 'inBase' ? a + (up ? 4 : -4) : b + (up ? 4 : -4);
                svg.text(x, mid, text, st, where === 'ctr' ? 'middle' : (where === 'outEnd') === up ? 'start' : 'end');
              } else {
                const y = where === 'ctr' ? (a + b) / 2 : where === 'inEnd' ? b + (up ? lh / 2 + 2 : -lh / 2 - 2) : where === 'inBase' ? a - (up ? lh / 2 + 2 : -lh / 2 - 2) : b - (up ? lh / 2 + 1 : -lh / 2 - 1);
                svg.text(mid, y, text, st);
              }
            });
          }
        }
      });
    } else if (plot.type === 'line' || plot.type === 'area' || plot.type === 'scatter') {
      const acc = new Array(nCats).fill(0);
      plot.series.forEach((s) => {
        const pts: ([number, number] | null)[] = [];
        const baseline: [number, number][] = [];
        const n = plot.type === 'scatter' ? s.values.length : nCats;
        for (let i = 0; i < n; i++) {
          const raw = s.values[i];
          const x = plot.type === 'scatter' ? (s.xValues?.[i] !== null && s.xValues?.[i] !== undefined ? xPos(s.xValues[i]!) : NaN) : catCenter(i);
          if (raw === null || raw === undefined || Number.isNaN(x)) {
            pts.push(null);
            continue;
          }
          let v = norm(raw, i);
          const from = stacked ? acc[i] : 0;
          if (stacked) {
            v = from + v;
            acc[i] = v;
          }
          const y = valPos(v, sc, rev);
          pts.push(horizontal ? [y, x] : [x, y]);
          baseline.push(horizontal ? [valPos(from, sc, rev), x] : [x, valPos(from, sc, rev)]);
        }
        const color = plot.type === 'area' ? seriesFill(s, plot, theme) : seriesStroke(s, theme).color;
        if (plot.type === 'area') {
          const run = pts.filter((p): p is [number, number] => !!p);
          if (run.length) {
            const d = run.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join('') + [...baseline].reverse().map(([x, y]) => `L${r2(x)} ${r2(y)}`).join('') + 'Z';
            svg.path(d, color, s.stroke && s.stroke.color !== 'auto' ? s.stroke : undefined);
          }
        } else {
          const stroke = seriesStroke(s, theme);
          // Gaps (empty cells) break the line.
          const runs: [number, number][][] = [[]];
          for (const p of pts) {
            if (p) runs[runs.length - 1].push(p);
            else if (runs[runs.length - 1].length) runs.push([]);
          }
          for (const run of runs) if (run.length > 1 && stroke.color !== 'none') svg.path(s.smooth ? smoothPath(run) : run.map(([x, y], i) => `${i ? 'L' : 'M'}${r2(x)} ${r2(y)}`).join(''), 'none', { ...stroke }, ' stroke-linecap="round"');
          if (s.marker) for (const p of pts) if (p) drawMarker(svg, p[0], p[1], s.marker, stroke.color === 'none' ? autoColor(s.index, theme) : stroke.color);
        }
        const opts = s.labels;
        if (opts && (opts.showVal || opts.showCatName || opts.showSerName || opts.showPercent))
          pts.forEach((p, i) => {
            if (!p) return;
            const text = labelText(s, i, s.values[i]!, totals[i] ?? 0, opts);
            const where = opts.pos ?? (plot.type === 'area' ? 'ctr' : 'r');
            labels.push(() => {
              const st = opts.style;
              const lh = lineHeight(st);
              if (where === 't') svg.text(p[0], p[1] - lh * 0.7, text, st);
              else if (where === 'b') svg.text(p[0], p[1] + lh * 0.7, text, st);
              else if (where === 'l') svg.text(p[0] - 6, p[1], text, st, 'end');
              else if (where === 'ctr') svg.text(p[0], p[1], text, st);
              else svg.text(p[0] + 6, p[1], text, st, 'start');
            });
          });
      });
    }
  }

  // The category axis line (at zero when it is in range), then its labels, the data table, or scatter's x labels.
  if (catAxis && !catAxis.deleted && catAxis.line && !scatter) {
    const at = valPos(Math.min(Math.max(0, primary.min), primary.max), primary, primaryVal?.reversed);
    if (horizontal) svg.line(at, plotTop, at, plotBottom, catAxis.line);
    else svg.line(plotLeft, at, plotRight, at, catAxis.line);
  }
  if (scatter && xScale && catShown) {
    if (catAxis?.line) svg.line(plotLeft, plotBottom, plotRight, plotBottom, catAxis.line);
    const fmt = catAxis?.formatCode && !(catAxis.sourceLinked && /general/i.test(catAxis.formatCode)) ? catAxis.formatCode : 'General';
    for (const t of ticksOf(xScale)) svg.text(xPos(t), plotBottom + 4 + lineHeight(catStyle) / 2, formatNumber(t, fmt), catStyle);
  } else if (table) {
    const st = table.style;
    const stroke = { ...table.stroke, color: table.stroke.color === 'auto' ? '#D9D9D9' : table.stroke.color };
    const tableTop = plotBottom;
    const tableLeft = plotLeft - tableKeyW;
    categories.forEach((c, i) => svg.text(bandStart(i) + bandLen / 2, tableTop + rowH / 2, c, st));
    tableSeries.forEach(({ s, p }, r) => {
      const y = tableTop + rowH * (r + 1);
      if (table.keys) drawKey(svg, tableLeft + 5, y + rowH / 2, { label: s.name, line: p.type === 'line', fill: p.type === 'line' ? undefined : seriesFill(s, p, theme), stroke: p.type === 'line' ? seriesStroke(s, theme) : undefined, marker: p.type === 'line' ? s.marker : undefined });
      svg.text(tableLeft + (table.keys ? keyW + 9 : 5), y + rowH / 2, s.name, st, 'start');
      s.values.forEach((v, i) => {
        if (v !== null) svg.text(bandStart(i) + bandLen / 2, y + rowH / 2, formatNumber(v, s.formatCode), st);
      });
      if (table.horz && r > 0) svg.line(tableLeft, y, plotRight, y, stroke);
    });
    const tableBottom = tableTop + rowH * (tableSeries.length + 1);
    if (table.vert)
      for (let i = 0; i <= nCats; i++) {
        const x = plotLeft + i * bandLen;
        svg.line(x, i === 0 || i === nCats ? tableTop + (i === 0 ? rowH : 0) : tableTop, x, tableBottom, stroke);
      }
    if (table.outline) {
      svg.line(tableLeft, tableTop + rowH, plotLeft, tableTop + rowH, stroke);
      svg.line(tableLeft, tableTop + rowH, tableLeft, tableBottom, stroke);
      svg.line(tableLeft, tableBottom, plotRight, tableBottom, stroke);
      svg.line(plotRight, tableTop, plotRight, tableBottom, stroke);
      svg.line(plotLeft, tableTop + rowH, plotLeft, tableBottom, stroke);
      svg.line(plotLeft, tableTop + rowH, plotRight, tableTop + rowH, stroke);
    }
  } else if (catShown) {
    if (horizontal) categories.forEach((c, i) => svg.text(plotLeft - 5, catCenter(i), c, catStyle, 'end'));
    else if (rotateCats) categories.forEach((c, i) => svg.text(catCenter(i) + 3, plotBottom + 6, c, catStyle, 'end', -45));
    else categories.forEach((c, i) => svg.text(catCenter(i), plotBottom + 4 + lineHeight(catStyle) / 2, c, catStyle));
  }

  for (const draw of labels) draw();
  return svg.done(W, H);
}

function drawKey(svg: Svg, x: number, y: number, it: LegendItem) {
  if (it.line) {
    const st = it.stroke ?? { color: '#000', width: 2 };
    svg.line(x, y, x + 22, y, { ...st, width: Math.min(st.width, 3), dash: st.dash });
    if (it.marker) drawMarker(svg, x + 11, y, it.marker, st.color);
  } else svg.rect(x, y - 4, 22, 8, it.fill ?? '#999');
}

function drawPie(svg: Svg, plot: Plot, theme: OfficeTheme, left: number, top: number, right: number, bottom: number) {
  const s = plot.series[0];
  if (!s) return;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const r = Math.max(5, (Math.min(right - left, bottom - top) / 2) * 0.92);
  const hole = plot.type === 'doughnut' ? (r * plot.holeSize) / 100 : 0;
  const values = s.values.map((v) => (v !== null && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return;
  let angle = (plot.firstSliceAng * Math.PI) / 180;
  const at = (a: number, rad: number): [number, number] => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  const labels: (() => void)[] = [];
  values.forEach((v, i) => {
    if (!v) return;
    const sweep = (v / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const fill = seriesFill(s, plot, theme, i);
    const large = sweep > Math.PI ? 1 : 0;
    const edge: Stroke = { color: '#FFFFFF', width: 1 };
    if (sweep >= Math.PI * 2 - 1e-6) {
      svg.parts.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="${esc(fill)}"/>`);
      if (hole) svg.parts.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(hole)}" fill="#FFFFFF"/>`);
    } else {
      const [x0, y0] = at(a0, r);
      const [x1, y1] = at(a1, r);
      let d = `M${r2(x0)} ${r2(y0)}A${r2(r)} ${r2(r)} 0 ${large} 1 ${r2(x1)} ${r2(y1)}`;
      if (hole) {
        const [x2, y2] = at(a1, hole);
        const [x3, y3] = at(a0, hole);
        d += `L${r2(x2)} ${r2(y2)}A${r2(hole)} ${r2(hole)} 0 ${large} 0 ${r2(x3)} ${r2(y3)}Z`;
      } else d += `L${r2(cx)} ${r2(cy)}Z`;
      svg.path(d, fill, edge);
    }
    const opts = s.labels;
    if (opts && (opts.showVal || opts.showPercent || opts.showCatName || opts.showSerName)) {
      const text = labelText(s, i, s.values[i]!, total, opts);
      const mid = (a0 + a1) / 2;
      const outside = opts.pos === 'outEnd';
      const [lx, ly] = at(mid, outside ? r + 12 : hole ? (r + hole) / 2 : r * 0.65);
      labels.push(() => svg.text(lx, ly, text, outside ? opts.style : { ...opts.style, color: opts.style.color === '#404040' ? '#FFFFFF' : opts.style.color }, outside ? (Math.sin(mid) >= 0 ? 'start' : 'end') : 'middle'));
    }
  });
  for (const l of labels) l();
}

/** An SVG string as something an <img> can show. */
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

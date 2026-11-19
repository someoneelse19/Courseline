// Charts in PowerPoint decks. pptx-preview draws charts with ECharts, which looks nothing like PowerPoint (its own
// colors, no data labels, no data table) and, inside our viewer, often draws only the axes: ECharts starts in a
// setTimeout while the viewer is still hidden and measures a 0 x 0 box. So each chart is drawn to an SVG here
// (lib/officeChart.ts, the same renderer the spreadsheet and Word views use), and after the deck is rendered each
// `.chart-node` box pptx-preview made is swapped for a picture of it (see replaceChartNodes).
import type JSZip from 'jszip';
import { DEFAULT_THEME, parseChart, readOfficeTheme, renderChartSvg, svgDataUrl, type OfficeTheme } from './officeChart';
import { resolvePath } from './xlsxStyles';

const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const EMU_PER_PX = 9525;

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

interface Rel {
  type: string;
  target: string;
}

/** A part's relationships: id -> type and the target's path inside the zip. */
async function relsOf(zip: JSZip, partPath: string): Promise<Map<string, Rel>> {
  const dir = partPath.slice(0, partPath.lastIndexOf('/') + 1);
  const xml = await zip.file(`${dir}_rels/${partPath.slice(dir.length)}.rels`)?.async('string');
  const out = new Map<string, Rel>();
  if (!xml) return out;
  for (const r of Array.from(parse(xml).getElementsByTagNameNS(NS_PKG_REL, 'Relationship'))) {
    if (r.getAttribute('TargetMode') === 'External') continue;
    out.set(r.getAttribute('Id') ?? '', { type: r.getAttribute('Type') ?? '', target: resolvePath(dir, r.getAttribute('Target') ?? '') });
  }
  return out;
}

/** The nearest enclosing element with this local name (any namespace). */
function ancestor(el: Element, name: string): Element | undefined {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.localName === name) return p;
  return undefined;
}

const relOfType = (rels: Map<string, Rel>, type: string) => [...rels.values()].find((r) => r.type.endsWith(`/${type}`))?.target;

/**
 * The charts on each slide (in the deck's order) as SVG markup, in the order they appear on the slide, at their size
 * on the slide. null for a chart that could not be read. Slides without charts get an empty list.
 */
export async function slideChartSvgs(zip: JSZip): Promise<(string | null)[][]> {
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXml) return [];
  const presRels = await relsOf(zip, 'ppt/presentation.xml');
  const slides = Array.from(parse(presXml).getElementsByTagNameNS(NS_P, 'sldId')).map((s) => presRels.get(s.getAttributeNS(NS_R, 'id') ?? '')?.target);
  const themes = new Map<string, OfficeTheme>();

  /** The theme a slide's colors come from: slide -> layout -> master -> theme. */
  async function themeOf(slideRels: Map<string, Rel>): Promise<OfficeTheme> {
    const layout = relOfType(slideRels, 'slideLayout');
    const master = layout ? relOfType(await relsOf(zip, layout), 'slideMaster') : undefined;
    const themePath = master ? relOfType(await relsOf(zip, master), 'theme') : undefined;
    if (!themePath) return DEFAULT_THEME;
    if (!themes.has(themePath)) themes.set(themePath, readOfficeTheme(await zip.file(themePath)?.async('string')));
    return themes.get(themePath) ?? DEFAULT_THEME;
  }

  const out: (string | null)[][] = [];
  for (const path of slides) {
    const xml = path ? await zip.file(path)?.async('string') : undefined;
    if (!path || !xml || !xml.includes(NS_C)) {
      out.push([]);
      continue;
    }
    const rels = await relsOf(zip, path);
    const theme = await themeOf(rels);
    const charts: (string | null)[] = [];
    for (const data of Array.from(parse(xml).getElementsByTagNameNS(NS_A, 'graphicData'))) {
      if (data.getAttribute('uri') !== NS_C) continue;
      // pptx-preview only looks at the first choice of an mc:AlternateContent, so neither does this.
      if (ancestor(data, 'Fallback')) continue;
      const frame = ancestor(data, 'graphicFrame');
      const ext = frame?.getElementsByTagNameNS(NS_P, 'xfrm')[0]?.getElementsByTagNameNS(NS_A, 'ext')[0];
      const width = Number(ext?.getAttribute('cx')) / EMU_PER_PX;
      const height = Number(ext?.getAttribute('cy')) / EMU_PER_PX;
      const ref = data.getElementsByTagNameNS(NS_C, 'chart')[0];
      const target = rels.get(ref?.getAttributeNS(NS_R, 'id') ?? '')?.target;
      const chartXml = target ? await zip.file(target)?.async('string') : undefined;
      try {
        charts.push(chartXml && width > 0 && height > 0 ? renderChartSvg(parseChart(chartXml, theme), width, height) : null);
      } catch {
        charts.push(null);
      }
    }
    out.push(charts);
  }
  return out;
}

/**
 * Swaps pptx-preview's ECharts boxes (`.chart-node`, one per chart, placed and sized by the library) for pictures of
 * the charts in `svgs` (from slideChartSvgs), slide by slide. A slide's own charts are its last chart boxes (any
 * before them come from its layout or master); a slide with fewer boxes than charts is left as the library drew it.
 */
export function replaceChartNodes(slides: HTMLElement[], svgs: (string | null)[][], alt: string): number {
  let replaced = 0;
  slides.forEach((slide, i) => {
    const mine = svgs[i] ?? [];
    const nodes = Array.from(slide.querySelectorAll<HTMLElement>('.chart-node'));
    const offset = nodes.length - mine.length;
    if (!mine.length || offset < 0) return;
    mine.forEach((svg, j) => {
      if (!svg) return;
      const node = nodes[offset + j];
      const img = document.createElement('img');
      img.src = svgDataUrl(svg);
      img.alt = alt;
      img.draggable = false;
      img.className = 'chart-node-image';
      img.style.cssText = node.style.cssText;
      // ECharts still starts on the old box a moment later; detached, it draws nowhere and is disposed with the deck.
      node.replaceWith(img);
      replaced++;
    });
  });
  return replaced;
}

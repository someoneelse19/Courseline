// Charts in Word documents. docx-preview draws pictures but skips charts (its parseGraphic only knows `pic`), so before
// the document goes to it, each chart is drawn to an SVG (lib/officeChart.ts, the same renderer the spreadsheet view
// uses) and put back in the zip as a picture of the same size: the SVG goes in word/media/, the part gets an image
// relationship to it, [Content_Types].xml says what .svg is (docx-preview takes the image's MIME type from there; without
// it the browser gets an untyped blob and shows nothing), and the drawing's graphicData becomes a `pic:pic`.
import type JSZip from 'jszip';
import { parseChart, readOfficeTheme, renderChartSvg } from './officeChart';
import { resolvePath } from './xlsxStyles';

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const EMU_PER_PX = 9525;
// Word's default chart size (6 x 3.5 in), for a drawing without an extent.
const DEFAULT_SIZE = { width: 576, height: 336 };

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);

/**
 * Replaces every chart in the document body, headers, footers, footnotes and endnotes with an SVG picture of it, in
 * place. Returns how many were replaced: with none the zip is untouched and the original bytes can be used as they are.
 */
export async function drawDocxCharts(zip: JSZip): Promise<number> {
  const parts = Object.keys(zip.files).filter((p) => /^word\/[^/]+\.xml$/.test(p));
  let themeXml: string | undefined;
  let theme: ReturnType<typeof readOfficeTheme> | undefined;
  let count = 0;
  for (const part of parts) {
    const xml = await zip.file(part)?.async('string');
    if (!xml || !xml.includes(NS_C)) continue;
    themeXml ??= (await zip.file('word/theme/theme1.xml')?.async('string')) ?? '';
    theme ??= readOfficeTheme(themeXml);

    const doc = parse(xml);
    const relsPath = `word/_rels/${part.slice('word/'.length)}.rels`;
    const relsXml = await zip.file(relsPath)?.async('string');
    const relsDoc = parse(relsXml ?? `<Relationships xmlns="${NS_PKG_REL}"/>`);
    const targets = new Map<string, string>();
    for (const r of Array.from(relsDoc.getElementsByTagNameNS(NS_PKG_REL, 'Relationship'))) {
      if (r.getAttribute('TargetMode') !== 'External') targets.set(r.getAttribute('Id') ?? '', resolvePath('word/', r.getAttribute('Target') ?? ''));
    }

    let changed = false;
    for (const data of Array.from(doc.getElementsByTagNameNS(NS_A, 'graphicData'))) {
      if (data.getAttribute('uri') !== NS_C) continue;
      const ref = data.getElementsByTagNameNS(NS_C, 'chart')[0];
      const target = targets.get(ref?.getAttributeNS(NS_R, 'id') ?? '');
      const chartXml = target ? await zip.file(target)?.async('string') : undefined;
      if (!chartXml) continue;

      // graphicData sits in a:graphic, which sits in the wp:inline or wp:anchor that holds the size.
      const holder = data.parentElement?.parentElement;
      const extent = holder ? Array.from(holder.children).find((c) => c.namespaceURI === NS_WP && c.localName === 'extent') : undefined;
      const cx = Number(extent?.getAttribute('cx'));
      const cy = Number(extent?.getAttribute('cy'));
      const width = cx > 0 ? cx / EMU_PER_PX : DEFAULT_SIZE.width;
      const height = cy > 0 ? cy / EMU_PER_PX : DEFAULT_SIZE.height;

      count++;
      const file = `courseline-chart-${count}.svg`;
      zip.file(`word/media/${file}`, renderChartSvg(parseChart(chartXml, theme), width, height));
      const relId = `rIdCourselineChart${count}`;
      const rel = relsDoc.createElementNS(NS_PKG_REL, 'Relationship');
      rel.setAttribute('Id', relId);
      rel.setAttribute('Type', IMAGE_REL);
      rel.setAttribute('Target', `media/${file}`);
      relsDoc.documentElement.appendChild(rel);

      data.replaceChildren(picture(doc, relId, Math.round(width * EMU_PER_PX), Math.round(height * EMU_PER_PX), count));
      data.setAttribute('uri', NS_PIC);
      changed = true;
    }
    if (changed) {
      zip.file(part, serialize(doc));
      zip.file(relsPath, serialize(relsDoc));
    }
  }
  if (count) await declareSvg(zip);
  return count;
}

/** A `pic:pic` showing the image behind `relId` at cx x cy EMU. */
function picture(doc: Document, relId: string, cx: number, cy: number, n: number): Element {
  const el = (ns: string, name: string, attrs: Record<string, string> = {}, ...children: Element[]) => {
    const e = doc.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...children);
    return e;
  };
  const blip = el(NS_A, 'a:blip');
  blip.setAttributeNS(NS_R, 'r:embed', relId);
  return el(
    NS_PIC,
    'pic:pic',
    {},
    el(NS_PIC, 'pic:nvPicPr', {}, el(NS_PIC, 'pic:cNvPr', { id: String(n), name: `Chart ${n}` }), el(NS_PIC, 'pic:cNvPicPr')),
    el(NS_PIC, 'pic:blipFill', {}, blip, el(NS_A, 'a:stretch', {}, el(NS_A, 'a:fillRect'))),
    el(
      NS_PIC,
      'pic:spPr',
      {},
      el(NS_A, 'a:xfrm', {}, el(NS_A, 'a:off', { x: '0', y: '0' }), el(NS_A, 'a:ext', { cx: String(cx), cy: String(cy) })),
      el(NS_A, 'a:prstGeom', { prst: 'rect' }),
    ),
  );
}

/** Makes sure [Content_Types].xml gives .svg files the SVG type. */
async function declareSvg(zip: JSZip) {
  const xml = await zip.file('[Content_Types].xml')?.async('string');
  if (!xml) return;
  const doc = parse(xml);
  const has = Array.from(doc.getElementsByTagNameNS(NS_CT, 'Default')).some((d) => d.getAttribute('Extension')?.toLowerCase() === 'svg');
  if (has) return;
  const def = doc.createElementNS(NS_CT, 'Default');
  def.setAttribute('Extension', 'svg');
  def.setAttribute('ContentType', 'image/svg+xml');
  doc.documentElement.insertBefore(def, doc.documentElement.firstChild);
  zip.file('[Content_Types].xml', serialize(doc));
}

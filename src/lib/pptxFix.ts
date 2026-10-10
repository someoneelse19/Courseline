// Works around a gap in pptx-preview: it applies a master's title style to titles, but never reads
// the master's body style (<p:txStyles><p:bodyStyle>), which is where PowerPoint keeps the bullets
// and font sizes of body text. Without it, bullet lists lose their bullets and shrink to the default
// size. The library does read a placeholder's own <a:lstStyle>, so before previewing we copy the body
// style into every empty body-like placeholder on the masters and layouts: the same inheritance
// PowerPoint applies. Anything that already has its own list style is left alone.

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const children = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const descendants = (root: Document | Element, name: string) => Array.from(root.getElementsByTagNameNS('*', name));

/** Placeholders that hold body text: no type (PowerPoint's default is the body), "body" or "obj". Not titles, dates, footers, pictures… */
function bodyPlaceholders(doc: Document): Element[] {
  return descendants(doc, 'ph')
    .filter((ph) => {
      const type = ph.getAttribute('type');
      return !type || type === 'body' || type === 'obj';
    })
    .map((ph) => {
      let el: Element | null = ph;
      while (el && el.localName !== 'sp') el = el.parentElement;
      return el;
    })
    .filter((sp): sp is Element => sp !== null);
}

/** PowerPoint puts body text at the top of its box unless told otherwise; pptx-preview centers it when no anchor is written. */
function anchorTop(txBody: Element): boolean {
  const bodyPr = children(txBody, 'bodyPr')[0];
  if (!bodyPr || bodyPr.hasAttribute('anchor')) return false;
  bodyPr.setAttribute('anchor', 't');
  return true;
}

function fillEmptyListStyle(sp: Element, levels: Element[]): boolean {
  const txBody = children(sp, 'txBody')[0];
  if (!txBody) return false;
  const anchored = anchorTop(txBody);
  let lst = children(txBody, 'lstStyle')[0];
  if (lst && lst.children.length > 0) return anchored; // it has its own style
  if (!lst) {
    lst = txBody.ownerDocument.createElementNS(DRAWING_NS, 'a:lstStyle');
    const bodyPr = children(txBody, 'bodyPr')[0];
    if (bodyPr?.nextSibling) txBody.insertBefore(lst, bodyPr.nextSibling);
    else txBody.appendChild(lst);
  }
  for (const level of levels) lst.appendChild(txBody.ownerDocument.importNode(level, true));
  return true;
}

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const hasError = (doc: Document) => doc.getElementsByTagName('parsererror').length > 0;

/** Returns the file with body styles applied (the same bytes when there was nothing to do or it could not be read). */
export async function applyMasterBodyStyles(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    const serializer = new XMLSerializer();
    let changed = false;

    // master path → its body style levels (lvl1pPr … lvl9pPr)
    const bodyStyles = new Map<string, Element[]>();
    for (const name of names.filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n))) {
      const doc = parse(await zip.file(name)!.async('string'));
      if (hasError(doc)) continue;
      const style = descendants(doc, 'bodyStyle')[0];
      const levels = style ? Array.from(style.children).filter((c) => /^lvl\dpPr$/.test(c.localName)) : [];
      if (levels.length === 0) continue;
      bodyStyles.set(name, levels);
      const edited = bodyPlaceholders(doc).filter((sp) => fillEmptyListStyle(sp, levels)).length > 0;
      if (edited) {
        zip.file(name, serializer.serializeToString(doc));
        changed = true;
      }
    }

    // Layouts: which master each belongs to is in its relationships file.
    for (const name of names.filter((n) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(n))) {
      const relsFile = zip.file(name.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels');
      if (!relsFile) continue;
      const rel = descendants(parse(await relsFile.async('string')), 'Relationship').find((r) => (r.getAttribute('Type') ?? '').endsWith('/slideMaster'));
      const master = rel ? `ppt/slideMasters/${(rel.getAttribute('Target') ?? '').split('/').pop()}` : '';
      const levels = bodyStyles.get(master);
      if (!levels) continue;
      const doc = parse(await zip.file(name)!.async('string'));
      if (hasError(doc)) continue;
      if (bodyPlaceholders(doc).filter((sp) => fillEmptyListStyle(sp, levels)).length > 0) {
        zip.file(name, serializer.serializeToString(doc));
        changed = true;
      }
    }

    return changed ? zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }) : bytes;
  } catch (err) {
    console.warn('[file viewer] could not apply the PowerPoint body styles', err);
    return bytes;
  }
}

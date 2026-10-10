import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applyMasterBodyStyles } from './pptxFix';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const placeholder = (id: number, ph: string, bodyPr: string, lst: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/><p:cNvSpPr/><p:nvPr><p:ph ${ph}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody>${bodyPr}${lst}<a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
const bodyStyle = '<a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr marL="742950"><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr>';
const master = (shapes: string) => `<?xml version="1.0"?><p:sldMaster ${NS}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle>${bodyStyle}</p:bodyStyle></p:txStyles></p:sldMaster>`;
const layout = (shapes: string) => `<?xml version="1.0"?><p:sldLayout ${NS}><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sldLayout>`;
const layoutRels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>';

async function build(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'arraybuffer' });
}
const read = async (bytes: ArrayBuffer, path: string) => new DOMParser().parseFromString(await (await JSZip.loadAsync(bytes)).file(path)!.async('string'), 'application/xml');
const lstStyleOf = (doc: Document, ph: string) => {
  const sp = Array.from(doc.getElementsByTagNameNS('*', 'sp')).find((s) => s.getElementsByTagNameNS('*', 'ph')[0]?.outerHTML.includes(ph))!;
  return Array.from(sp.getElementsByTagNameNS('*', 'lstStyle')[0]?.children ?? []).map((c) => c.localName);
};

describe('applyMasterBodyStyles', () => {
  const files = {
    'ppt/slideMasters/slideMaster1.xml': master(
      placeholder(2, 'type="title"', '<a:bodyPr anchor="ctr"/>', '<a:lstStyle/>') + placeholder(3, 'type="body" idx="1"', '<a:bodyPr/>', '<a:lstStyle/>'),
    ),
    'ppt/slideLayouts/slideLayout1.xml': layout(
      placeholder(2, 'type="title"', '<a:bodyPr/>', '<a:lstStyle/>') +
        placeholder(3, 'idx="1"', '<a:bodyPr/>', '<a:lstStyle/>') + // PowerPoint writes a body placeholder with no type
        placeholder(4, 'idx="2"', '<a:bodyPr/>', '<a:lstStyle><a:lvl1pPr><a:defRPr sz="1000"/></a:lvl1pPr></a:lstStyle>'), // has its own style
    ),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': layoutRels,
  };

  it('copies the master body style into empty body placeholders on the master and the layouts', async () => {
    const out = await applyMasterBodyStyles(await build(files));
    const m = await read(out, 'ppt/slideMasters/slideMaster1.xml');
    expect(lstStyleOf(m, 'type="body"')).toEqual(['lvl1pPr', 'lvl2pPr']);
    const l = await read(out, 'ppt/slideLayouts/slideLayout1.xml');
    expect(lstStyleOf(l, 'idx="1"')).toEqual(['lvl1pPr', 'lvl2pPr']);
    // the bullets and sizes came along
    expect(l.getElementsByTagNameNS('*', 'buChar')[0].getAttribute('char')).toBe('•');
    expect(l.getElementsByTagNameNS('*', 'defRPr')[0].getAttribute('sz')).toBe('2800');
  });

  it('leaves titles and placeholders that have their own style alone', async () => {
    const out = await applyMasterBodyStyles(await build(files));
    const l = await read(out, 'ppt/slideLayouts/slideLayout1.xml');
    expect(lstStyleOf(l, 'type="title"')).toEqual([]);
    expect(lstStyleOf(l, 'idx="2"')).toEqual(['lvl1pPr']);
    expect(l.getElementsByTagNameNS('*', 'defRPr').length).toBe(3); // 2 copied levels + the layout's own
  });

  it('puts body text at the top of its box unless an anchor is set', async () => {
    const out = await applyMasterBodyStyles(await build(files));
    const m = await read(out, 'ppt/slideMasters/slideMaster1.xml');
    const bodyPrs = Array.from(m.getElementsByTagNameNS('*', 'bodyPr'));
    expect(bodyPrs[0].getAttribute('anchor')).toBe('ctr'); // title: untouched
    expect(bodyPrs[1].getAttribute('anchor')).toBe('t');
  });

  it('returns the same bytes when there is nothing to do, and survives garbage', async () => {
    const plain = await build({ 'ppt/presentation.xml': '<p:presentation/>' });
    expect(await applyMasterBodyStyles(plain)).toBe(plain);
    const garbage = new TextEncoder().encode('not a zip').buffer as ArrayBuffer;
    expect(await applyMasterBodyStyles(garbage)).toBe(garbage);
  });
});

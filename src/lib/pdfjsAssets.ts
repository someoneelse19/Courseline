// Where PDF.js finds what some PDFs need besides the file itself (served at /pdfjs/ by vite.config.ts, pdfjsAssets):
// the WebAssembly image decoders (without them JBIG2 images, which scanners use, and JPEG 2000 ones are left out of the
// page), the 14 standard fonts, the character maps (Chinese, Japanese, Korean text) and the color profile. Absolute
// addresses, as the PDF.js worker resolves them on its own. Pass to every getDocument call.
export function pdfjsAssets() {
  const at = (dir: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, window.location.href).href;
  return { wasmUrl: at('wasm'), standardFontDataUrl: at('standard_fonts'), cMapUrl: at('cmaps'), cMapPacked: true, iccUrl: at('iccs') };
}

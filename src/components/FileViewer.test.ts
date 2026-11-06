import { describe, expect, it } from 'vitest';
import { withFontFallback } from './FileViewer';

describe('withFontFallback: a Word document\'s fonts on a computer that lacks them', () => {
  it('gives an Office sans font (Aptos, Calibri) sans-serif stand-ins, not the browser\'s default serif', () => {
    expect(withFontFallback('Aptos')).toBe('Aptos, Aptos, Calibri, Carlito, "Helvetica Neue", Arial, sans-serif');
    expect(withFontFallback("'Calibri Light'")).toMatch(/sans-serif$/);
  });

  it('keeps serif and monospace fonts in their kind, and leaves a list that already ends in a generic family alone', () => {
    expect(withFontFallback('Cambria')).toMatch(/, serif$/);
    expect(withFontFallback("'Times New Roman'")).toMatch(/, serif$/);
    expect(withFontFallback('Consolas')).toMatch(/monospace$/);
    expect(withFontFallback('Georgia, serif')).toBe('Georgia, serif');
    expect(withFontFallback('')).toBe('');
  });
});

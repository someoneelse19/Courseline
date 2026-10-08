import { afterEach, describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, ACCENT_SHADES, DEFAULT_ACCENT, accentVars, applyAccent, isHex } from './accent';

afterEach(() => document.documentElement.removeAttribute('style'));

const channels = (v: string) => v.split(' ').map(Number);
const luminance = ([r, g, b]: number[]) => {
  const c = [r, g, b].map((x) => (x / 255 <= 0.03928 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

describe('accentVars', () => {
  it('produces all 11 shades as "r g b" triples', () => {
    const vars = accentVars('#ea580c');
    expect(Object.keys(vars)).toHaveLength(ACCENT_SHADES.length);
    for (const v of Object.values(vars)) expect(v).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
  });

  it('uses the chosen color itself as shade 600', () => {
    expect(accentVars('#ea580c')['--accent-600']).toBe('234 88 12');
  });

  it('runs from light (50) to dark (950)', () => {
    const vars = accentVars('#2563eb');
    const lum = ACCENT_SHADES.map((s) => luminance(channels(vars[`--accent-${s}`])));
    expect([...lum].sort((a, b) => b - a)).toEqual(lum);
  });

  it('darkens a color too light for white button text until contrast is at least 3:1', () => {
    const shade600 = channels(accentVars('#facc15')['--accent-600']);
    expect(1.05 / (luminance(shade600) + 0.05)).toBeGreaterThanOrEqual(3);
  });
});

describe('applyAccent', () => {
  const root = () => document.documentElement.style;

  it('sets the CSS variables for a custom color and returns them', () => {
    const vars = applyAccent('#ea580c');
    expect(vars).not.toBeNull();
    expect(root().getPropertyValue('--accent-600')).toBe('234 88 12');
  });

  it('clears the overrides for null and for the default color', () => {
    applyAccent('#ea580c');
    expect(applyAccent(null)).toBeNull();
    expect(root().getPropertyValue('--accent-600')).toBe('');
    applyAccent('#ea580c');
    applyAccent(DEFAULT_ACCENT);
    expect(root().getPropertyValue('--accent-600')).toBe('');
  });
});

describe('presets', () => {
  it('the first preset is the default and every preset is a valid hex', () => {
    expect(ACCENT_PRESETS[0].hex).toBe(DEFAULT_ACCENT);
    for (const p of ACCENT_PRESETS) expect(isHex(p.hex)).toBe(true);
  });
  it('isHex rejects anything else', () => {
    for (const bad of ['red', '#fff', '#12345', '#1234567', null, 5]) expect(isHex(bad)).toBe(false);
  });
});

// The app's accent color is a Tailwind palette (`accent-50` … `accent-950`) backed by CSS
// variables. With no custom color the defaults in index.css apply (Tailwind's blue);
// picking a color generates the whole palette from it.

export const ACCENT_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'Purple', hex: '#9333ea' },
  { name: 'Gray', hex: '#525252' },
];

export const DEFAULT_ACCENT = ACCENT_PRESETS[0].hex;

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}

// How far each shade moves from the base (600) toward white (<600) or near-black (>600).
const LIGHTER: Record<number, number> = { 500: 0.2, 400: 0.42, 300: 0.65, 200: 0.82, 100: 0.92, 50: 0.97 };
const DARKER: Record<number, number> = { 700: 0.2, 800: 0.4, 900: 0.6, 950: 0.78 };

const luminance = ([r, g, b]: number[]) => {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrastWithWhite = (rgb: number[]) => 1.05 / (luminance(rgb) + 0.05);

/** Palette as CSS variable values ("r g b"). Shade 600 is the chosen color itself. */
export function accentVars(hex: string): Record<string, string> {
  const [h, s, l0] = hexToHsl(hex);
  // Buttons are accent-600 with white text, so a color too light for that is darkened until it reads.
  let base = l0;
  while (base > 5 && contrastWithWhite(hslToRgb(h, s, base)) < 3) base -= 1;
  const vars: Record<string, string> = {};
  for (const shade of ACCENT_SHADES) {
    let l = base;
    if (shade < 600) l = base + (97 - base) * LIGHTER[shade];
    if (shade > 600) l = base + (12 - base) * DARKER[shade];
    // Pale tints look garish at full saturation.
    const sat = shade <= 100 ? Math.min(s, 90) : s;
    vars[`--accent-${shade}`] = hslToRgb(h, sat, l).join(' ');
  }
  return vars;
}

/** Applies (or, with null, clears) the custom accent on <html>. Returns the variables applied. */
export function applyAccent(hex: string | null): Record<string, string> | null {
  const root = document.documentElement;
  const vars = hex && hex.toLowerCase() !== DEFAULT_ACCENT ? accentVars(hex) : null;
  for (const shade of ACCENT_SHADES) {
    const name = `--accent-${shade}`;
    if (vars) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  return vars;
}

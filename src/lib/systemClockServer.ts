import { execFile } from 'node:child_process';
import type { SystemClock } from './systemClock';

// Dev server only (Node): browsers don't see the computer's own time settings. Chrome on a Mac shows
// "3:06 PM" even with the 24-hour switch on in System Settings, so the dev server reads the settings and
// puts them in index.html (see vite.config.ts). Read on every page load, so a change shows after a reload.

const readDefault = (key: string) =>
  new Promise<string | null>((resolve) =>
    execFile('defaults', ['read', '-g', key], { timeout: 2000 }, (err, out) => resolve(err ? null : out.trim())),
  );

/** macOS "en_US", "es_ES", "en_GB@rg=eszzzz" (region set apart from the language) → "en-US", "es-ES", "en-ES". */
export function localeTag(appleLocale: string): string | undefined {
  const m = appleLocale.match(/^([a-z]{2,3})(?:_[A-Z][a-z]{3})?(?:_([A-Z]{2}|\d{3}))?/);
  if (!m) return undefined;
  const region = appleLocale.match(/[@;]rg=([a-z]{2})zzzz/i)?.[1]?.toUpperCase() ?? m[2];
  return region ? `${m[1]}-${region}` : m[1];
}

export async function readSystemClock(): Promise<SystemClock> {
  if (process.platform !== 'darwin') return {};
  const [locale, force24, force12, firstWeekday] = await Promise.all(
    ['AppleLocale', 'AppleICUForce24HourTime', 'AppleICUForce12HourTime', 'AppleFirstWeekday'].map(readDefault),
  );
  const clock: SystemClock = {};
  const tag = locale ? localeTag(locale) : undefined;
  if (tag) clock.locale = tag;
  if (force24 === '1') clock.hourCycle = 'h23';
  else if (force12 === '1') clock.hourCycle = 'h12';
  // `{ gregorian = 2; }`: 1 is Sunday, 2 Monday ... 7 Saturday.
  const day = firstWeekday?.match(/gregorian\s*=\s*([1-7])/)?.[1];
  if (day) clock.firstDay = Number(day) - 1;
  return clock;
}

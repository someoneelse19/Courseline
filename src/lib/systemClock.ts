// Times and calendars follow the computer's settings: 12- or 24-hour clock and the first day of the week.
// The dev server reads them from macOS and puts them in <meta name="courseline-clock"> (see
// systemClockServer.ts); anywhere else they come from the browser's own region. The words (month and
// weekday names) still follow the app language.

export interface SystemClock {
  /** The region's locale, e.g. "en-US": its defaults apply where the settings below are not set. */
  locale?: string;
  hourCycle?: 'h12' | 'h23';
  /** 0 = Sunday ... 6 = Saturday. */
  firstDay?: number;
}

/** The settings in the meta tag; anything malformed is dropped. */
export function parseClock(content: string | null | undefined): SystemClock {
  let raw: unknown;
  try {
    raw = JSON.parse(content ?? '{}');
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const clock: SystemClock = {};
  if (typeof r.locale === 'string' && /^[a-z]{2,3}(-([A-Z]{2}|\d{3}))?$/.test(r.locale)) clock.locale = r.locale;
  if (r.hourCycle === 'h12' || r.hourCycle === 'h23') clock.hourCycle = r.hourCycle;
  if (Number.isInteger(r.firstDay) && (r.firstDay as number) >= 0 && (r.firstDay as number) <= 6) clock.firstDay = r.firstDay as number;
  return clock;
}

let cached: { hourCycle: 'h12' | 'h23'; firstDay: number | undefined } | undefined;

function regionLocale(clock: SystemClock): string {
  return clock.locale ?? (typeof navigator === 'undefined' ? 'en-US' : navigator.language);
}

function resolve() {
  if (cached) return cached;
  const clock = parseClock(typeof document === 'undefined' ? null : document.querySelector('meta[name="courseline-clock"]')?.getAttribute('content'));
  const region = regionLocale(clock);
  let hourCycle = clock.hourCycle;
  if (!hourCycle) {
    // `hourCycle` is missing from the ES2020 types but every current browser reports it.
    const regional = (new Intl.DateTimeFormat(region, { hour: 'numeric' }).resolvedOptions() as { hourCycle?: string }).hourCycle;
    hourCycle = regional === 'h11' || regional === 'h12' ? 'h12' : 'h23';
  }
  let firstDay = clock.firstDay;
  if (firstDay === undefined) {
    try {
      const loc = new Intl.Locale(region) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
      const info = loc.getWeekInfo?.() ?? loc.weekInfo;
      if (info) firstDay = info.firstDay % 7; // Intl: 1 = Monday ... 7 = Sunday
    } catch {
      /* old browser: the caller falls back */
    }
  }
  cached = { hourCycle, firstDay };
  return cached;
}

/** Date options with the computer's 12/24-hour clock (only matters when they show the hour). */
export const withClock = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions =>
  options.hour ? { ...options, hourCycle: resolve().hourCycle } : options;

/** The weekday a calendar week starts on (0 = Sunday ... 6 = Saturday), or `fallback` if unknown. */
export const weekStartDay = (fallback: number): number => resolve().firstDay ?? fallback;

/** Tests: forget the settings read so far. */
export const resetClock = () => {
  cached = undefined;
};

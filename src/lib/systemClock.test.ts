import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { formatDue } from './format';
import { timeOf } from './messages';
import { parseClock, resetClock, weekStartDay, withClock } from './systemClock';
import { localeTag } from './systemClockServer';

function setMeta(content: string) {
  document.querySelector('meta[name="courseline-clock"]')?.remove();
  const meta = document.createElement('meta');
  meta.name = 'courseline-clock';
  meta.content = content;
  document.head.append(meta);
  resetClock();
}

afterEach(() => {
  document.querySelector('meta[name="courseline-clock"]')?.remove();
  resetClock();
  setLanguage('en');
});

const at1506 = new Date(2026, 9, 29, 15, 6).toISOString();

describe('system clock', () => {
  it('uses the 24-hour clock when the computer does, even in English', () => {
    setMeta('{"locale":"en-US","hourCycle":"h23","firstDay":1}');
    expect(timeOf(at1506)).toBe('15:06');
    expect(formatDue(at1506)).toContain('15:06');
    expect(weekStartDay(0)).toBe(1);
  });

  it('uses the 12-hour clock when the computer does, even in Spanish', () => {
    setLanguage('es');
    setMeta('{"locale":"es-ES","hourCycle":"h12"}');
    expect(timeOf(at1506)).toMatch(/^3:06\s?p/);
  });

  it("falls back to the region's own clock and first weekday", () => {
    setMeta('{"locale":"es-ES"}');
    expect(timeOf(at1506)).toBe('15:06');
    expect(weekStartDay(0)).toBe(1);
    setMeta('{"locale":"en-US"}');
    expect(timeOf(at1506)).toBe('3:06 PM');
    expect(weekStartDay(1)).toBe(0);
  });

  it('leaves options without an hour alone and drops malformed settings', () => {
    setMeta('{"hourCycle":"h23"}');
    expect(withClock({ month: 'short' })).toEqual({ month: 'short' });
    expect(parseClock('not json')).toEqual({});
    expect(parseClock('{"locale":"<x>","hourCycle":"h24","firstDay":9}')).toEqual({});
  });

  it('turns macOS locales into region tags', () => {
    expect(localeTag('en_US')).toBe('en-US');
    expect(localeTag('es_ES')).toBe('es-ES');
    expect(localeTag('en_GB@rg=eszzzz')).toBe('en-ES');
    expect(localeTag('zh_Hans_CN')).toBe('zh-CN');
    expect(localeTag('fr')).toBe('fr');
  });
});

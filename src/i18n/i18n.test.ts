import { afterEach, describe, expect, it } from 'vitest';
import { es } from './es';
import { detectLanguage, setLanguage, t } from './index';

afterEach(() => {
  setLanguage('en');
  localStorage.removeItem('courseline.language');
});

describe('t()', () => {
  it('returns English unchanged and fills {placeholders}', () => {
    expect(t('Dashboard')).toBe('Dashboard');
    expect(t('{count} of {total} selected', { count: 2, total: 5 })).toBe('2 of 5 selected');
  });

  it('translates to Spanish, and falls back to English for unknown strings', () => {
    setLanguage('es');
    expect(t('Dashboard')).toBe('Panel');
    expect(t('{count} of {total} selected', { count: 2, total: 5 })).toBe('2 de 5 seleccionados');
    expect(t('Not in the dictionary')).toBe('Not in the dictionary');
  });

  it('leaves unknown placeholders alone', () => {
    expect(t('Hello {name}', {})).toBe('Hello {name}');
  });
});

describe('detectLanguage()', () => {
  it('prefers the saved choice over the browser language', () => {
    localStorage.setItem('courseline.language', 'es');
    expect(detectLanguage()).toBe('es');
  });

  it('ignores a saved value it does not know', () => {
    localStorage.setItem('courseline.language', 'fr');
    expect(detectLanguage()).toBe('en'); // jsdom's browser language is en-US
  });
});

describe('Spanish dictionary', () => {
  it('keeps every {placeholder} of the English text', () => {
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [english, spanish] of Object.entries(es)) expect(holes(spanish), english).toBe(holes(english));
  });
});

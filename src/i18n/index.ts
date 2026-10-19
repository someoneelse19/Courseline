import { es } from './es';
import { pt } from './pt';

// Minimal i18n: English text IS the key. `t('Dashboard')` returns it unchanged in English and
// looks it up in a dictionary for other languages, falling back to English when a string is
// missing. `{name}` placeholders are filled from the second argument. Changing language
// remounts the app (see LanguageContext), so plain function calls are enough: no hooks needed.

export type Language = 'en' | 'es' | 'pt';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
];

const dictionaries: Record<Language, Record<string, string>> = { en: {}, es, pt };
const STORAGE_KEY = 'courseline.language';

let current: Language = 'en';

export const getLanguage = () => current;

/** The BCP 47 locale for dates and numbers (Portuguese means Brazilian Portuguese). */
const LOCALES: Record<Language, string> = { en: 'en', es: 'es', pt: 'pt-BR' };
export const getLocale = () => LOCALES[current];
export const setLanguage = (language: Language) => {
  current = language;
};

/** Saved choice, else the browser's language, else English. */
export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LANGUAGES.some((l) => l.code === saved)) return saved as Language;
  } catch {
    /* storage unavailable */
  }
  const browser = typeof navigator === 'undefined' ? 'en' : navigator.language;
  const base = browser.toLowerCase();
  return base.startsWith('es') ? 'es' : base.startsWith('pt') ? 'pt' : 'en';
}

export function saveLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* ignore */
  }
}

/** t() with a singular form: pass the count and both English strings (each needs its own dictionary entry). */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : other, { n, ...vars });
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const translated = dictionaries[current][text] ?? text;
  return vars ? translated.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match)) : translated;
}

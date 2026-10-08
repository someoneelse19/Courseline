import { es } from './es';

// Minimal i18n: English text IS the key. `t('Dashboard')` returns it unchanged in English and
// looks it up in a dictionary for other languages, falling back to English when a string is
// missing. `{name}` placeholders are filled from the second argument. Changing language
// remounts the app (see LanguageContext), so plain function calls are enough: no hooks needed.

export type Language = 'en' | 'es';

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

const dictionaries: Record<Language, Record<string, string>> = { en: {}, es };
const STORAGE_KEY = 'courseline.language';

let current: Language = 'en';

export const getLanguage = () => current;
export const setLanguage = (language: Language) => {
  current = language;
};

/** Saved choice, else the browser's language, else English. */
export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    /* storage unavailable */
  }
  const browser = typeof navigator === 'undefined' ? 'en' : navigator.language;
  return browser.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function saveLanguage(language: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* ignore */
  }
}

export function t(text: string, vars?: Record<string, string | number>): string {
  const translated = dictionaries[current][text] ?? text;
  return vars ? translated.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match)) : translated;
}

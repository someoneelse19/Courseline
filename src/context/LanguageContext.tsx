import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { detectLanguage, saveLanguage, setLanguage as applyLanguage, type Language } from '../i18n';

interface LanguageValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setState] = useState<Language>(() => {
    const initial = detectLanguage();
    applyLanguage(initial); // must be set before the first child renders
    return initial;
  });

  const setLanguage = useCallback((next: Language) => {
    applyLanguage(next);
    saveLanguage(next);
    setState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);

  // Strings are translated with plain t() calls, so changing language remounts the tree
  // to make every one of them re-render. It happens once, when the user picks a language.
  return (
    <LanguageContext.Provider value={value}>
      <Fragment key={language}>{children}</Fragment>
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return ctx;
}

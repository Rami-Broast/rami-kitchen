import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { Lang, dirFor, pickName, translate } from './i18n';

const LANG_KEY = 'rami.pos.lang';

function loadLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_KEY);
    return raw === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

interface LangContextValue {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (lang: Lang) => void;
  toggle: () => void;
  /** Translate a fixed UI key. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Pick the localised name of a catalog record (falls back to English). */
  name: (names: { name: string; nameAr?: string | null }) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

/** Owns the EN/AR choice, persists it, and mirrors direction onto the document. */
export function LangProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>(() => loadLang());

  const setLang = useCallback((next: Lang): void => {
    setLangState(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    // Reflect direction + language on <html> so native form controls, scrollbars
    // and text selection follow the reading direction too.
    document.documentElement.lang = lang;
    document.documentElement.dir = dirFor(lang);
  }, [lang]);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      dir: dirFor(lang),
      setLang,
      toggle: () => setLang(lang === 'en' ? 'ar' : 'en'),
      t: (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
      name: (names) => pickName(lang, names),
    }),
    [lang, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) {
    throw new Error('useLang must be used within LangProvider');
  }
  return ctx;
}

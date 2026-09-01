'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALE_LABELS,
  LOCALE_STORAGE_KEY,
  isLocale,
  setActiveLocale,
  translate,
  type Locale,
  type TranslationKey,
  type TranslationParams,
} from '@/lib/i18n';

interface I18nContextValue {
  /** The language the interface is currently in. */
  locale: Locale;
  /** Switch languages and remember the choice for next time. */
  setLocale: (locale: Locale) => void;
  /** Translate a key, interpolating `{name}` parameters. */
  t: (key: TranslationKey, params?: TranslationParams) => string;
  /** The languages this deployment offers, in switcher order. */
  locales: readonly Locale[];
  /** How each of those languages names itself. */
  localeLabels: Record<Locale, string>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * What language to start in, for a browser that has been here before or has
 * said something about its owner's preferences.
 *
 * A remembered choice wins outright. Failing that, the browser's own language
 * list is consulted in order and matched on the primary subtag, so `hu-HU`
 * finds `hu`. Only then does the deployment default apply.
 */
function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored) && ENABLED_LOCALES.includes(stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode); carry on with detection.
  }

  const preferred = window.navigator.languages ?? [window.navigator.language];
  for (const tag of preferred) {
    const primary = tag.split('-')[0]?.toLowerCase();
    if (isLocale(primary) && ENABLED_LOCALES.includes(primary)) return primary;
  }

  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Starts on the deployment default rather than on the detected language:
  // this tree renders on the server too, where neither localStorage nor
  // navigator exist, and reading them during render would make the server and
  // the browser disagree about the first paint. Detection happens on mount.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const detected = detectLocale();
    if (detected !== DEFAULT_LOCALE) setLocaleState(detected);
  }, []);

  // Keep the document in step: `lang` is what a screen reader picks a voice
  // from and what the browser hyphenates and spell-checks against.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    if (!ENABLED_LOCALES.includes(next)) return;
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // The switch still works; it just will not be recalled next visit.
    }
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    // Published before any child renders so that the plain formatting helpers
    // in `@/lib/format`, which read the active locale rather than take it as
    // an argument, agree with the text rendered in the same pass.
    setActiveLocale(locale);
    return {
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      locales: ENABLED_LOCALES,
      localeLabels: LOCALE_LABELS,
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Read the current language and its dictionary.
 *
 * Throws outside the provider rather than quietly falling back to English: a
 * component rendering untranslated text is a bug worth failing loudly on.
 */
export function useTranslation(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used inside <I18nProvider>');
  }
  return context;
}

/**
 * Which languages the interface is available in, and which one it starts in.
 *
 * Adding a language is three steps: add its tag here, drop a dictionary next
 * to `locales/en.ts` that satisfies `Translations`, and register it in
 * `locales/index.ts`. TypeScript refuses to build until the new dictionary
 * covers every key, so a half-translated language cannot ship by accident.
 */

export const LOCALES = ['en', 'hu'] as const;

export type Locale = (typeof LOCALES)[number];

/** How each language names itself, for a switcher that reads in its own tongue. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  hu: 'Magyar',
};

/**
 * BCP 47 tag handed to `Intl` for dates and numbers. Kept apart from the
 * locale key so a future 'pt' could format as 'pt-BR' without renaming keys.
 */
export const LOCALE_INTL_TAGS: Record<Locale, string> = {
  en: 'en-US',
  hu: 'hu-HU',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Deployment-level configuration. Both are read at build time (Next inlines
 * `NEXT_PUBLIC_*`), so a server running a Hungarian community can ship with
 * Hungarian as the language everyone lands on:
 *
 *   NEXT_PUBLIC_DEFAULT_LOCALE=hu
 *   NEXT_PUBLIC_LOCALES=hu,en
 *
 * Anything unrecognised in either variable is ignored rather than fatal — a
 * typo in an env file should not take the interface down.
 */
const FALLBACK_LOCALE: Locale = 'en';

function readDefaultLocale(): Locale {
  const configured = process.env.NEXT_PUBLIC_DEFAULT_LOCALE?.trim();
  return isLocale(configured) ? configured : FALLBACK_LOCALE;
}

function readEnabledLocales(): readonly Locale[] {
  const configured = process.env.NEXT_PUBLIC_LOCALES;
  if (!configured) return LOCALES;
  const picked = configured
    .split(',')
    .map((tag) => tag.trim())
    .filter(isLocale);
  // An empty or entirely bogus list would leave the switcher with nothing to
  // offer, so fall back to everything that is built in.
  return picked.length > 0 ? picked : LOCALES;
}

/** The language the interface starts in when the visitor has no preference. */
export const DEFAULT_LOCALE: Locale = readDefaultLocale();

/** The languages this deployment offers, in the order the switcher lists them. */
export const ENABLED_LOCALES: readonly Locale[] = (() => {
  const enabled = readEnabledLocales();
  // The default has to be offered, otherwise the app starts in a language the
  // user has no way to leave.
  return enabled.includes(DEFAULT_LOCALE) ? enabled : [DEFAULT_LOCALE, ...enabled];
})();

/** Where the visitor's own choice is remembered between sessions. */
export const LOCALE_STORAGE_KEY = 'faction-accountant:locale';

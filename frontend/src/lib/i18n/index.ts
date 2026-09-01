/**
 * Interface translation.
 *
 * A small hand-rolled layer rather than a library: the app is a single
 * client-rendered screen driven by a zustand view switch, so the routing and
 * server-component machinery a full i18n package brings would sit unused. What
 * is here is the part that earns its keep — a typed key set, parameter
 * interpolation, plural forms, and a fallback chain.
 *
 * English is the source of truth. `locales/en.ts` defines the key set, and
 * every other dictionary is typed against it, so a language cannot be added
 * with a key missing or misspelled: the build fails instead.
 *
 * React components should reach for `useTranslation()` from
 * `@/providers/i18n-provider`; this module is the locale-agnostic core it
 * wraps, and is also what non-React helpers (`@/lib/format`) read.
 */

import {
  DEFAULT_LOCALE,
  LOCALE_INTL_TAGS,
  type Locale,
} from './config';
import { dictionaries } from './locales';
import type { PluralForms, TranslationKey, TranslationValue } from './locales/en';

export type { Locale } from './config';
export {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALES,
  LOCALE_LABELS,
  LOCALE_INTL_TAGS,
  LOCALE_STORAGE_KEY,
  isLocale,
} from './config';
export type { PluralForms, TranslationKey, Translations, TranslationValue } from './locales/en';

export type TranslationParams = Record<string, string | number>;

// ── Plural selection ───────────────────────────────────────────────────────

const pluralRules = new Map<Locale, Intl.PluralRules>();

function pluralRulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALE_INTL_TAGS[locale]);
    pluralRules.set(locale, rules);
  }
  return rules;
}

function isPluralForms(value: TranslationValue): value is PluralForms {
  return typeof value !== 'string';
}

/**
 * Pick a plural form. Only `one` and `other` are carried: both languages the
 * app ships with need no more, and a category `Intl` returns but the dictionary
 * does not define falls back to `other` rather than showing a raw key.
 */
function selectPluralForm(forms: PluralForms, count: number, locale: Locale): string {
  return pluralRulesFor(locale).select(count) === 'one' ? forms.one : forms.other;
}

// ── Interpolation ──────────────────────────────────────────────────────────

/**
 * Replace every `{name}` with the matching parameter. Placeholders without a
 * parameter are left as written — visible in the UI, which is the fastest way
 * to notice a call site that forgot an argument.
 */
function interpolate(template: string, params: TranslationParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

// ── Lookup ─────────────────────────────────────────────────────────────────

const warnedMissing = new Set<string>();

function warnMissing(locale: Locale, key: string) {
  if (process.env.NODE_ENV === 'production') return;
  const seen = `${locale}:${key}`;
  if (warnedMissing.has(seen)) return;
  warnedMissing.add(seen);
  console.warn(`[i18n] missing "${key}" for locale "${locale}"`);
}

/**
 * Translate `key` into `locale`.
 *
 * The fallback chain is requested locale → English → the key itself. The last
 * step matters in practice: a key that slips through renders as
 * "members.title" rather than as an empty gap in the layout.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  let entry: TranslationValue | undefined = dictionaries[locale]?.[key];
  if (entry === undefined) {
    warnMissing(locale, key);
    entry = dictionaries[DEFAULT_LOCALE]?.[key];
  }
  if (entry === undefined) return key;

  if (isPluralForms(entry)) {
    const count = typeof params?.count === 'number' ? params.count : Number(params?.count ?? 0);
    return interpolate(selectPluralForm(entry, count, locale), params);
  }
  return interpolate(entry, params);
}

// ── Active locale ──────────────────────────────────────────────────────────

/**
 * The locale the interface is currently in, kept outside React so that
 * `@/lib/format` — plain functions called from render, chart tooltips and
 * event handlers alike — can format dates and numbers the same way without
 * every caller threading a locale argument through.
 *
 * `I18nProvider` owns this: it writes here whenever the locale changes, and
 * that same change re-renders everything reading the context, so what is on
 * screen and what this returns never drift apart.
 */
let activeLocale: Locale = DEFAULT_LOCALE;

export function setActiveLocale(locale: Locale) {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/** The BCP 47 tag for the active locale, for `Intl` and `toLocaleString`. */
export function getIntlLocale(): string {
  return LOCALE_INTL_TAGS[activeLocale];
}

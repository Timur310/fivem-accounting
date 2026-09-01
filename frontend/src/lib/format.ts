/**
 * Amount, date and name formatting.
 *
 * Dates follow the language the interface is in, read from `getIntlLocale()`
 * rather than taken as an argument: these helpers are called from render
 * bodies, chart tooltips and event handlers alike, and threading a locale
 * through every one of them would be noise. `I18nProvider` keeps that value in
 * step with what is on screen.
 *
 * Numbers deliberately do not. See NUMBER_LOCALE below.
 */

import { getIntlLocale } from './i18n';

/**
 * Money and quantities are formatted the American way in every language:
 * "$1,234.56", never "$1 234,56".
 *
 * This is the one place the interface does not follow the reader's language,
 * and it is on purpose. The figures here mirror what the game shows in-game,
 * and players read and repeat them to each other as they appear there — a
 * comma that means "decimal point" in one language and "thousands separator"
 * in another is a real way to mis-pay someone. Dates carry no such risk, so
 * those are localised.
 */
export const NUMBER_LOCALE = 'en-US';

/** Format a number as an amount of the given item type. */
export function formatAmount(
  value: number | string,
  unit: string,
  isCurrency: boolean | undefined,
): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';

  if (isCurrency) {
    return `${unit}${n.toLocaleString(NUMBER_LOCALE, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  // Counts are whole things. Keep decimals only when the value actually has
  // them, so "2.5 kg" survives while "30 pcs" does not become "30.00 pcs".
  const hasFraction = Math.abs(n % 1) > 1e-9;
  const formatted = n.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

/**
 * Format a signed amount, always showing the sign.
 * Used where inflow and outflow sit side by side.
 */
export function formatSignedAmount(
  value: number,
  unit: string,
  isCurrency: boolean | undefined,
): string {
  const sign = value < 0 ? '-' : '+';
  return `${sign}${formatAmount(Math.abs(value), unit, isCurrency)}`;
}

/** Plain two-decimal number format with thousands separators. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Whole-number format with thousands separators, for counts. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(NUMBER_LOCALE, { maximumFractionDigits: 0 });
}

/**
 * A date on its own, in the interface language.
 *
 * These used to call `toLocaleDateString()` with no locale, which follows the
 * browser's settings — so someone reading the app in Hungarian on an
 * English-configured machine got Hungarian labels above American dates.
 */
export function formatDate(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(getIntlLocale());
}

/** A date and a time, for logs and anywhere the hour matters. */
export function formatDateTime(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(getIntlLocale());
}

/** Local YYYY-MM-DD string (avoids UTC drift from toISOString). */
export function todayLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** In-game name when set, Discord username as fallback. */
export function displayName(user: { username: string; inGameName?: string | null }): string {
  return user.inGameName?.trim() || user.username;
}

/**
 * Both names at once: "Vito Corleone (vito_c)".
 *
 * Payouts are matched against a Discord account but paid to a character, so a
 * single name is never enough to identify who a row is about. Collapses to the
 * Discord name alone when no in-game name has been set.
 */
export function fullDisplayName(user: { username: string; inGameName?: string | null }): string {
  const inGame = user.inGameName?.trim();
  return inGame ? `${inGame} (${user.username})` : user.username;
}

import type { Locale } from '../config';
import type { Translations } from './en';
import { en } from './en';
import { hu } from './hu';

/**
 * Every dictionary the build knows about, keyed by locale.
 *
 * Typing the map as `Record<Locale, Translations>` is what forces a new
 * language to be complete: add a tag to `LOCALES` without a dictionary here
 * and the type is unsatisfied, add a dictionary missing a key and `Translations`
 * rejects it.
 */
export const dictionaries: Record<Locale, Translations> = { en, hu };

import { describe, it, expect } from 'vitest';
import { en } from './en';
import { hu } from './hu';

/**
 * The two locale files, checked against each other.
 *
 * TypeScript already proves that Hungarian has every key English has — the
 * `TranslationKey` union is derived from `en`. What it cannot see is what is
 * *inside* the strings, and that is where the failures are: a `{name}` dropped
 * in translation silently renders a sentence with a hole in it, and a word
 * that drifts to a synonym makes the app read as though two people wrote it.
 *
 * These are the first tests in the frontend. They were worth writing first
 * because they cost nothing to run and they catch the class of mistake nobody
 * notices in review: the app compiles, the screen renders, and only a
 * Hungarian player reading it knows something is wrong.
 */

const keys = Object.keys(en) as (keyof typeof en)[];

/**
 * Every string in an entry.
 *
 * A value is either a string or a `{ one, other }` pair chosen by a count, so
 * both forms are flattened and checked — a placeholder dropped from the plural
 * form only shows up for somebody who has two of something.
 */
const strings = (value: string | { one: string; other: string }): string[] =>
  typeof value === 'string' ? [value] : [value.one, value.other];

const holes = (value: string | { one: string; other: string }) =>
  strings(value)
    .flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
    .sort();

describe('the locales agree', () => {
  it('has the same keys in both', () => {
    expect(Object.keys(hu).sort()).toEqual(Object.keys(en).sort());
  });

  // A placeholder dropped in translation is invisible until somebody reads a
  // sentence that is missing the number it was about.
  it('keeps every placeholder', () => {
    const dropped = keys
      .filter((key) => holes(en[key]).join() !== holes(hu[key]).join())
      .map((key) => `${key}: en[${holes(en[key])}] hu[${holes(hu[key])}]`);
    expect(dropped).toEqual([]);
  });

  it('has no empty translation', () => {
    const empty = keys.filter((key) =>
      [...strings(en[key]), ...strings(hu[key])].some((text) => !text.trim()));
    expect(empty).toEqual([]);
  });

  // A key written as a plural in one language and a plain string in the other
  // loses its count form wherever the flat one is used.
  it('keeps the plural entries plural in both', () => {
    const mismatched = keys.filter((key) => typeof en[key] !== typeof hu[key]);
    expect(mismatched).toEqual([]);
  });
});

/**
 * One word per thing, in both languages.
 *
 * This app calls a group of players a **faction**, and Hungarian FiveM servers
 * call it a **frakció**. Three features in a row arrived translating it as
 * "szövetség" — an alliance — because each was written on its own and nobody
 * reading one screen could see the other. That is exactly the kind of drift a
 * review misses and a player notices immediately, so it is pinned here instead
 * of being remembered.
 *
 * Add to this list when a word gets decided, not when it gets broken.
 */
const BANNED_HU: { wrong: RegExp; instead: string; why: string }[] = [
  {
    wrong: /szövetség/i,
    instead: 'frakció',
    why: 'szövetség means alliance; this app calls the group a faction',
  },
  {
    wrong: /pénztár/i,
    instead: 'kassza',
    why: 'the treasury is the kassza everywhere else in the app',
  },
];

describe('hungarian terminology', () => {
  for (const { wrong, instead, why } of BANNED_HU) {
    it(`says "${instead}" rather than "${wrong.source}" (${why})`, () => {
      const offenders = keys
        .filter((key) => strings(hu[key]).some((text) => wrong.test(text)))
        .map((key) => `${key}: ${strings(hu[key]).join(' / ')}`);
      expect(offenders).toEqual([]);
    });
  }
});

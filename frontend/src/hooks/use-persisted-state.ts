'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * `useState` that remembers itself across navigation and reloads.
 *
 * Filters and sort orders are settings, not transient UI: someone who narrows
 * the entries list to one member and clicks into their profile expects to come
 * back to the same list. Views are unmounted on every navigation here (the
 * shell swaps components rather than routing), so component state alone loses
 * it every time.
 *
 * Reads happen in an effect rather than in the initializer on purpose. This
 * tree renders on the server too, where `localStorage` does not exist, and
 * seeding from it during render would make the server and client markup
 * disagree. The first paint is the default; the stored value arrives
 * immediately after.
 *
 * Every access is wrapped: a browser with site data blocked throws on the
 * accessor itself, and a filter preference is never worth breaking a page for.
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  // Guards the first write-back: without it the default overwrites whatever
  // was stored before the read effect has had a chance to run.
  const hydrated = useRef(false);

  useEffect(() => {
    if (!key) {
      hydrated.current = true;
      return;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // Unreadable or unparseable — the default stands.
    }
    hydrated.current = true;
    // Re-reads when the key changes, which is how a per-faction key switches
    // to that faction's own stored value.
  }, [key]);

  useEffect(() => {
    if (!key || !hydrated.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked. The filter still works for this session.
    }
  }, [key, value]);

  const set = useCallback((next: T | ((prev: T) => T)) => setValue(next), []);
  return [value, set];
}

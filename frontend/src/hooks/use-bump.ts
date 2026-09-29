'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A key that changes when a count goes up, and only then.
 *
 * Put it on a badge as `key` and give the badge the `badge-bump` class: every
 * time the number rises the element is fresh, so its entrance plays once and
 * the eye is drawn to it. Falling counts do nothing — somebody reading their
 * notifications does not need a flourish for having read one.
 *
 * The first value seen is the starting point rather than an increase, so a
 * badge does not bump just because the page loaded with something in it.
 */
export function useBump(count: number): number {
  const previous = useRef<number | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (previous.current !== null && count > previous.current) setKey((k) => k + 1);
    previous.current = count;
  }, [count]);

  return key;
}

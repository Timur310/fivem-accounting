'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that travels to its new value instead of jumping to it.
 *
 * The dashboard had this inline, and it counted from **zero** every time: the
 * query has `staleTime: 0` and refetches on window focus, so glancing away and
 * back replayed the faction's entire balance from nothing, and logging an
 * entry did the same rather than showing the entry landing. Counting from the
 * previous value is what makes the movement mean something — the distance
 * travelled is the change.
 *
 * The first arrival still counts up from zero. That one is a reveal rather
 * than a change, and it is the only time there is no previous value to travel
 * from.
 *
 * Honours `prefers-reduced-motion`: the value is simply set, with no frames.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(0);
  const previous = useRef(0);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;

    if (from === target) {
      setDisplay(target);
      return;
    }

    let reduced = false;
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      // Older browsers, and any environment without matchMedia. Animating is
      // the safe default there; refusing to render is not.
    }
    if (reduced) {
      setDisplay(target);
      return;
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // Ease-out cubic: quick off the mark, settling rather than stopping.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return display;
}

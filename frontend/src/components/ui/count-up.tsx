'use client';

import { useEffect, useRef, useState } from 'react';
import { duration } from '@/lib/motion';

/** Decelerating: fast at first, settling onto the value. */
const easeOut = (t: number) => 1 - (1 - t) ** 3;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * A number that counts to its value instead of appearing.
 *
 * From zero the first time it is shown, and from the old value to the new one
 * afterwards — so a balance that goes up after an entry is logged visibly
 * climbs, which says "that changed" far better than a digit silently swapping.
 *
 * Plain `requestAnimationFrame` rather than Motion: a count is one number
 * changing, and Motion would add nothing to it but weight.
 *
 * The in-between frames are formatted with `format`, but the last frame always
 * shows `final` when it is given, exactly as the caller would have rendered
 * it. Money here is a decimal string and can be longer than a float can hold;
 * the animation may round on the way, the resting value never does.
 */
export function CountUp({
  value,
  format,
  final,
  className,
}: {
  value: number;
  /** How to write a number, for the frames in between. */
  format: (n: number) => string;
  /** The exact text to rest on, if the formatted float would not be exact. */
  final?: string;
  className?: string;
}) {
  const [reduced] = useState(prefersReducedMotion);
  const [shown, setShown] = useState<number | null>(null);
  /**
   * The number actually on screen, or null before anything has been.
   *
   * Counting always starts from here rather than from the last target, so a
   * value that changes mid-count carries on from where the digits are instead
   * of jumping; and React's development double-run of effects, which cancels
   * the first run, simply resumes from the same place.
   */
  const live = useRef<number | null>(null);

  useEffect(() => {
    const from = live.current ?? 0;
    if (from === value || !Number.isFinite(value) || reduced) {
      live.current = value;
      setShown(null);
      return;
    }

    const start = performance.now();
    const ms = duration.count * 1000;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      if (t >= 1) {
        live.current = value;
        setShown(null);
        return;
      }
      const n = from + (value - from) * easeOut(t);
      live.current = n;
      setShown(n);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  // The render where the value has just changed comes before the effect that
  // counts it. Show where the count will start, or the new number flashes up
  // for a frame and then drops back to count up to itself.
  const counting = shown !== null || (!reduced && Number.isFinite(value) && live.current !== value);
  const current = shown ?? live.current ?? 0;

  // At rest, the exact value — not a float's idea of it.
  const text = counting ? format(current) : (final ?? format(value));
  return <span className={className}>{text}</span>;
}

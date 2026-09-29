import type { Transition, Variants } from 'motion/react';

/**
 * The app's motion vocabulary, in one place.
 *
 * Subtle on purpose. People keep this open all evening beside the game and
 * switch screens dozens of times a night, so nothing here may make anybody
 * wait: every entrance is under a quarter of a second, nothing blocks input
 * while it runs, and exits are skipped entirely rather than delaying the next
 * screen. Motion here says "this changed", it does not perform.
 *
 * Every animation in the app goes through `MotionProvider`, which follows the
 * operating system's reduced-motion setting — so anything built from these
 * tokens turns itself off for the people who asked for that, without each call
 * site having to remember.
 */

/** Seconds, because that is what Motion takes. */
export const duration = {
  /** Hover, press, a colour change. Felt rather than seen. */
  instant: 0.12,
  /** Something appearing: a row, a card, a toast. */
  quick: 0.18,
  /** A whole screen arriving. */
  screen: 0.22,
  /** A number counting to its value. Long enough to read as motion. */
  count: 0.6,
} as const;

/**
 * Easings as cubic-bezier control points.
 *
 * `out` decelerates — things arrive fast and settle — which is what an
 * entrance should feel like. `inOut` is for something moving between two
 * resting places, like a highlight sliding along the sidebar.
 */
export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, [number, number, number, number]>;

/** A spring for things that slide between positions. Settles without bouncing. */
export const glide: Transition = { type: 'spring', stiffness: 520, damping: 42, mass: 0.8 };

/**
 * A screen arriving: a short settle and a fade.
 *
 * Every entrance moves *down* into place, never up. Something arriving from
 * below overflows the bottom of whatever scrolls around it for the length of
 * the animation, and the browser shows a scrollbar that blinks away again;
 * overflow past the top edge never scrolls.
 */
export const screenIn: Variants = {
  hidden: { opacity: 0, y: -6 },
  shown: { opacity: 1, y: 0, transition: { duration: duration.screen, ease: ease.out } },
};

/** One item in a list or grid arriving, all at once. */
export const itemIn: Variants = {
  hidden: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0, transition: { duration: duration.quick, ease: ease.out } },
};

/**
 * One item in a list arriving a moment after the one before it.
 *
 * The delay is worked out from the item's position and capped: past the first
 * dozen rows the rest simply appear, because a hundred-row ledger waterfalling
 * in for two seconds is the opposite of "never make anybody wait".
 */
export function itemAt(index: number, step = 0.025, cap = 12): Variants {
  const delay = Math.min(index, cap) * step;
  return {
    hidden: { opacity: 0, y: -4 },
    shown: { opacity: 1, y: 0, transition: { duration: duration.quick, ease: ease.out, delay } },
  };
}

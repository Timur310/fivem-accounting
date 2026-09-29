'use client';

import { LazyMotion, MotionConfig, domMax } from 'motion/react';

/**
 * Every animation in the app, under one switch.
 *
 * `reducedMotion="user"` follows the operating system: somebody who has asked
 * their computer for less movement gets fades without the slides and springs,
 * everywhere, without a single call site having to remember to check. The CSS
 * side has the matching rule in globals.css.
 *
 * `LazyMotion` with `strict` is the size discipline. Components are written as
 * `m.div` from `motion/react-m`, which carries no animation code of its own,
 * and the features load once here. `strict` makes a stray full `motion.div`
 * throw in development instead of quietly pulling the whole library back in.
 * `domMax` rather than the smaller `domAnimation` because the sidebar's
 * sliding highlight uses shared layout, which only the larger set includes.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

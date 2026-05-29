/**
 * Shared Framer Motion (the `motion` package) variants + transitions.
 *
 * Centralizing these keeps the redesign's motion vocabulary consistent: every
 * surface fades-up, staggers, and springs the same way instead of each
 * component re-authoring timings. Durations mirror the CSS `--duration-*`
 * tokens (0.22s confirm, 0.38s morph) so CSS- and JS-driven motion agree.
 *
 * Reduced motion is handled globally by `MotionProvider` (`reducedMotion="user"`),
 * which neutralizes transforms/opacity transitions for users who ask for it.
 */
import type { Variants, Transition } from "motion/react";

export const easeConfirm = [0.32, 0.72, 0, 1] as const;

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 30,
  mass: 0.7,
};

export const springGentle: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 28,
};

/** Container that staggers its children in source order. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

/** Standard fade-up — the default entrance for cards, rows, sections. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.38, ease: easeConfirm },
  },
};

/** Smaller fade-up for dense list rows. */
export const fadeUpSm: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: easeConfirm } },
};

/** Spring pop — for badges, checks, and confirmations. */
export const springPop: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  show: { opacity: 1, scale: 1, transition: springSnappy },
};

/** Page-level transition for route changes inside the app shell. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.34, ease: easeConfirm } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: easeConfirm } },
};

/** Hover/tap props for interactive tiles and cards. */
export const interactiveTile = {
  whileHover: { y: -2 },
  whileTap: { scale: 0.99 },
  transition: springSnappy,
} as const;

/** Hover/tap props for buttons. */
export const interactiveButton = {
  whileHover: { y: -1 },
  whileTap: { scale: 0.97 },
  transition: springSnappy,
} as const;

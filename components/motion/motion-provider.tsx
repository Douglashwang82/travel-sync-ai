"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { easeConfirm } from "@/components/motion/variants";

/**
 * App-wide motion configuration. `reducedMotion="user"` makes every `motion`
 * component honor the OS "reduce motion" setting automatically (transform and
 * layout animations are skipped, opacity is kept), matching the CSS
 * `prefers-reduced-motion` block in globals.css. A single default transition
 * keeps incidental animations on the shared easing curve.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: 0.3, ease: easeConfirm }}
    >
      {children}
    </MotionConfig>
  );
}

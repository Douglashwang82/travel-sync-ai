"use client";

/**
 * The AI planner's "reasoning" indicator — a breathing aurora orb paired with a
 * rotating line describing *what it's thinking about*. The wait communicates
 * context ("reading the chat", "scanning dates") instead of a generic spinner,
 * which is the right tone for an agentic, context-first surface.
 *
 * The orb itself is a CSS aurora blob (gc-orb keyframes in globals.css); the
 * phrase cross-fades on an interval. Both collapse under reduced motion: the orb
 * stops breathing and a single static phrase shows.
 */

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { springGentle } from "@/components/motion/variants";

const ROTATE_MS = 2200;

export function ThinkingOrb({ phrases, label }: { phrases: string[]; label: string }) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduced || phrases.length <= 1) return;
    const id = setInterval(() => setI((p) => (p + 1) % phrases.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [reduced, phrases.length]);

  const phrase = phrases.length > 0 ? phrases[i % phrases.length] : label;

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={springGentle}
      className="flex items-center gap-2.5 px-1 py-0.5"
      aria-label={label}
    >
      <span aria-hidden className="gc-orb" />
      <span className="min-w-0 text-[12px] text-[var(--text-secondary)]">
        <AnimatePresence mode="wait">
          <motion.span
            key={phrase}
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.32 }}
            className="inline-block [font-family:var(--font-display)] tracking-tight"
          >
            {phrase}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.li>
  );
}

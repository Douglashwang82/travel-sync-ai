"use client";

/**
 * Word-by-word, blur→sharp reveal for the AI planner's messages — the marquee
 * "text-first" gesture of the redesign. In an agentic app the agent's words are
 * the product, so they should feel *authored live* rather than pasted in.
 *
 * Only live agent messages stream (see `useLiveMessageIds`); history renders
 * instantly. Under reduced motion the whole string appears at once. Newlines are
 * preserved so multi-paragraph reasoning keeps its shape.
 */

import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { easeConfirm } from "@/components/motion/variants";

const PER_WORD_MS = 26; // stagger between words
const MAX_STAGGER_MS = 1400; // cap so long messages don't crawl

export function StreamingText({
  text,
  stream,
}: {
  text: string;
  stream: boolean;
}) {
  const reduced = useReducedMotion();
  // Split into words while preserving whitespace/newlines as their own tokens,
  // so spacing and line breaks survive the per-word wrapping.
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);

  if (!stream || reduced) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  const wordCount = tokens.filter((t) => t.trim().length > 0).length || 1;
  const step = Math.min(PER_WORD_MS, MAX_STAGGER_MS / wordCount) / 1000;

  // Precompute each token's word-order index (whitespace tokens get -1) so the
  // render pass stays free of mutable counters.
  let seen = 0;
  const delays = tokens.map((tok) => (tok.trim().length === 0 ? -1 : seen++));

  return (
    <span className="whitespace-pre-wrap break-words">
      {tokens.map((tok, i) =>
        delays[i] < 0 ? (
          <span key={i}>{tok}</span>
        ) : (
          <motion.span
            key={i}
            initial={{ opacity: 0, filter: "blur(6px)", y: "0.18em" }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            transition={{ duration: 0.34, ease: easeConfirm, delay: delays[i] * step }}
            className="inline-block"
          >
            {tok}
          </motion.span>
        ),
      )}
    </span>
  );
}

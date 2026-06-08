"use client";

/**
 * The one true foreground 3D object of the chat redesign: the AI planner's grid
 * proposal, rendered as a glass card that tilts toward the cursor with a
 * pointer-tracking specular sheen and an aurora gradient border. Crucially it's
 * *context-first* — the agent's rationale (the context it extracted from the
 * conversation) is the hero copy, with the grid title/agent as supporting
 * identity. Confirm is a gradient action; dismiss is quiet.
 *
 * Tilt + sheen come from `usePointerTilt` and collapse to a flat card under
 * reduced motion. The card preserves 3D via a `transform-style: preserve-3d`
 * wrapper so the lift reads as depth, not a skew.
 */

import { motion, useMotionTemplate, useTransform } from "motion/react";
import { Sparkles } from "lucide-react";
import { interactiveButton } from "@/components/motion/variants";
import { usePointerTilt } from "@/components/app/chat/use-pointer-tilt";

export function ProposalCard3D({
  eyebrow,
  title,
  subtitle,
  rationale,
  icon,
  confirmLabel,
  dismissLabel,
  deciding,
  onConfirm,
  onDismiss,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  rationale: string;
  icon?: string;
  confirmLabel: string;
  dismissLabel: string;
  deciding: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const tilt = usePointerTilt(10);
  // Build the sheen position from the normalized glare coords (0..1 → %).
  const sheenX = useTransform(tilt.glareX, (v) => `${v * 100}%`);
  const sheenY = useTransform(tilt.glareY, (v) => `${v * 100}%`);
  const sheen = useMotionTemplate`radial-gradient(180px 180px at ${sheenX} ${sheenY}, rgb(255 255 255 / 0.22), transparent 60%)`;

  return (
    <div style={{ perspective: 900 }}>
      <motion.div
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY, transformStyle: "preserve-3d" }}
        initial={{ opacity: 0, y: 14, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 22 }}
        className="proposal-3d tile-glow relative overflow-hidden rounded-[var(--radius-lg)] p-4"
      >
        {/* Pointer-tracking specular sheen. */}
        <motion.span
          aria-hidden
          style={{ background: sheen }}
          className="pointer-events-none absolute inset-0 z-0"
        />
        <div className="relative z-10" style={{ transform: "translateZ(28px)" }}>
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-line)]">
            <Sparkles className="h-3 w-3" aria-hidden />
            {eyebrow}
          </div>

          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-base)] text-base shadow-[var(--shadow-raise)]"
            >
              {icon ?? "✨"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-[var(--text-primary)] [font-family:var(--font-display)]">
                {title}
              </p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">{subtitle}</p>
            </div>
          </div>

          {/* Context-first: the rationale is the hero. */}
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">{rationale}</p>

          <div className="mt-3.5 flex items-center gap-1.5">
            <motion.button
              {...interactiveButton}
              type="button"
              disabled={deciding}
              onClick={onConfirm}
              className="btn-gradient rounded-full px-4 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {confirmLabel}
            </motion.button>
            <button
              type="button"
              disabled={deciding}
              onClick={onDismiss}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {dismissLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

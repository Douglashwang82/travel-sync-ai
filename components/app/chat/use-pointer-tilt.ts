"use client";

/**
 * Pointer-driven 3D tilt + parallax primitives for the "Living Canvas" chat
 * redesign. Two hooks, both reduced-motion aware:
 *
 *   usePointerTilt   — local card tilt (rotateX/rotateY + specular sheen) that
 *                      springs toward the cursor and eases home on leave. Used
 *                      by the AI proposal widget — the one foreground 3D object.
 *   usePointerField  — element-relative normalized pointer (−1..1) shared via a
 *                      spring, for parallaxing *background depth layers* (mesh,
 *                      glow, the thinking orb). Text never parallaxes — only the
 *                      ambient layers behind it — so reading stays crisp.
 *
 * Both collapse to inert values when the user asks for reduced motion, so the
 * surface stays fully legible and functional.
 */

import { useCallback, useRef } from "react";
import {
  useMotionValue,
  useSpring,
  useReducedMotion,
  type MotionValue,
} from "motion/react";

const TILT_SPRING = { stiffness: 220, damping: 22, mass: 0.6 } as const;
const FIELD_SPRING = { stiffness: 90, damping: 20, mass: 0.8 } as const;

export interface PointerTilt {
  /** Attach to the tilting element. */
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  /** Spring-smoothed rotations (deg) — bind to `style.rotateX` / `rotateY`. */
  rotateX: MotionValue<number>;
  rotateY: MotionValue<number>;
  /** Normalized cursor position (0..1) for a pointer-tracking sheen gradient. */
  glareX: MotionValue<number>;
  glareY: MotionValue<number>;
}

/**
 * @param maxTilt peak rotation in degrees at the card's edges.
 */
export function usePointerTilt(maxTilt = 9): PointerTilt {
  const reduced = useReducedMotion();
  const rotateX = useSpring(useMotionValue(0), TILT_SPRING);
  const rotateY = useSpring(useMotionValue(0), TILT_SPRING);
  const glareX = useSpring(useMotionValue(0.5), TILT_SPRING);
  const glareY = useSpring(useMotionValue(0.5), TILT_SPRING);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (reduced) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width; // 0..1
      const py = (e.clientY - rect.top) / rect.height; // 0..1
      rotateY.set((px - 0.5) * 2 * maxTilt);
      rotateX.set((0.5 - py) * 2 * maxTilt);
      glareX.set(px);
      glareY.set(py);
    },
    [reduced, maxTilt, rotateX, rotateY, glareX, glareY],
  );

  const onPointerLeave = useCallback(() => {
    rotateX.set(0);
    rotateY.set(0);
    glareX.set(0.5);
    glareY.set(0.5);
  }, [rotateX, rotateY, glareX, glareY]);

  return { onPointerMove, onPointerLeave, rotateX, rotateY, glareX, glareY };
}

export interface PointerField {
  /** Attach to the field whose pointer drives the parallax. */
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  /** Spring-smoothed, element-relative cursor in −1..1 (centered). */
  x: MotionValue<number>;
  y: MotionValue<number>;
}

export function usePointerField(): PointerField {
  const reduced = useReducedMotion();
  const x = useSpring(useMotionValue(0), FIELD_SPRING);
  const y = useSpring(useMotionValue(0), FIELD_SPRING);
  const raf = useRef<number | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (reduced) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        x.set(nx);
        y.set(ny);
      });
    },
    [reduced, x, y],
  );

  const onPointerLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  return { onPointerMove, onPointerLeave, x, y };
}

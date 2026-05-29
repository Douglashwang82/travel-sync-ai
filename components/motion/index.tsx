"use client";

import type { ComponentProps, ElementType, ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react";
import { cn } from "@/lib/utils";
import {
  fadeUp,
  fadeUpSm,
  pageTransition,
  staggerContainer,
} from "@/components/motion/variants";

export { MotionProvider } from "@/components/motion/motion-provider";

/**
 * `Reveal` — fades + lifts its content into view the first time it scrolls
 * into the viewport. Wraps any block. Honors reduced motion via MotionConfig.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variants = fadeUp,
  as = "div",
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variants?: Variants;
  as?: ElementType;
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once, margin: "-10% 0px -10% 0px" });
  const MotionTag = motion[as as "div"] ?? motion.div;
  return (
    <MotionTag
      ref={ref}
      className={className}
      variants={variants}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      transition={{ delay }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * `Stagger` + `StaggerItem` — a container that cascades its children in.
 * Use `StaggerItem` for each direct child.
 */
export function Stagger({
  children,
  className,
  as = "div",
  amount = 0.15,
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
  amount?: number;
}) {
  const MotionTag = motion[as as "div"] ?? motion.div;
  return (
    <MotionTag
      className={className}
      variants={staggerContainer}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
    >
      {children}
    </MotionTag>
  );
}

export function StaggerItem({
  children,
  className,
  small = false,
  as = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  small?: boolean;
  as?: ElementType;
} & Omit<ComponentProps<typeof motion.div>, "variants">) {
  const MotionTag = motion[as as "div"] ?? motion.div;
  return (
    <MotionTag className={className} variants={small ? fadeUpSm : fadeUp} {...rest}>
      {children}
    </MotionTag>
  );
}

/** Page-level enter/exit transition for app routes. */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={pageTransition}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

/**
 * `AnimatedNumber` — springs from 0 to `value` when mounted / when value
 * changes. Renders an accessible static number for reduced-motion users
 * because the spring resolves near-instantly there.
 */
export function AnimatedNumber({
  value,
  className,
  format,
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 20, mass: 0.8 });
  const display = useTransform(spring, (n) =>
    format ? format(n) : Math.round(n).toLocaleString(),
  );
  useEffect(() => {
    mv.set(value);
  }, [mv, value]);
  return <motion.span className={cn("text-mono", className)}>{display}</motion.span>;
}

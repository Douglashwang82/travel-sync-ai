"use client";

/**
 * The "Living Canvas" composer: a floating glass command bar that lifts off the
 * bottom edge, glows with an aurora focus ring, auto-grows with the draft, and
 * ends in a magnetic gradient send orb that springs toward the cursor. Replaces
 * the boxy textarea + rectangular "Send" of the old layout.
 *
 * Pure presentation — value/submit are owned by the parent so the SSE + send
 * data flow is untouched. Magnetism + lift are reduced-motion aware.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, MessageSquare, Sparkles } from "lucide-react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const MAG_SPRING = { stiffness: 260, damping: 18, mass: 0.5 } as const;

/** Composer send modes: a plain chat message, or a message that's also
 * dispatched to the AI planner as a task. */
export type ComposerMode = "message" | "task";

export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  taskPlaceholder,
  disabled,
  sending,
  mode,
  onModeChange,
  messageLabel,
  taskLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Placeholder shown in task mode. */
  taskPlaceholder: string;
  disabled: boolean;
  sending: boolean;
  /** Current send mode (controlled by the parent). */
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  /** Localized segmented-toggle labels. */
  messageLabel: string;
  taskLabel: string;
}) {
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isTask = mode === "task";

  // Auto-grow the textarea to fit the draft (cap at ~5 rows).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  }, [value]);

  // Magnetic send orb.
  const magX = useSpring(useMotionValue(0), MAG_SPRING);
  const magY = useSpring(useMotionValue(0), MAG_SPRING);
  const onOrbMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (reduced) return;
      const r = e.currentTarget.getBoundingClientRect();
      magX.set(((e.clientX - r.left) / r.width - 0.5) * 14);
      magY.set(((e.clientY - r.top) / r.height - 0.5) * 14);
    },
    [reduced, magX, magY],
  );
  const onOrbLeave = useCallback(() => {
    magX.set(0);
    magY.set(0);
  }, [magX, magY]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }
  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  const canSend = !disabled && !sending && value.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="px-3 pb-3 pt-1">
      <div role="tablist" aria-label={`${messageLabel} / ${taskLabel}`} className="mb-1.5 inline-flex rounded-full border border-[var(--border-hairline)] bg-[var(--surface-base)] p-0.5 text-[10px] font-semibold">
        <ModeTab
          active={!isTask}
          onClick={() => onModeChange("message")}
          icon={<MessageSquare className="h-3 w-3" aria-hidden />}
          label={messageLabel}
        />
        <ModeTab
          active={isTask}
          onClick={() => onModeChange("task")}
          icon={<Sparkles className="h-3 w-3" aria-hidden />}
          label={taskLabel}
        />
      </div>
      <div
        data-focused={focused}
        data-mode={mode}
        className={cn("chat-composer flex items-end gap-2 px-2.5 py-2", disabled && "opacity-60")}
      >
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={1}
          disabled={disabled}
          placeholder={isTask ? taskPlaceholder : placeholder}
          className="max-h-[132px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none"
        />
        <motion.button
          type="submit"
          disabled={!canSend}
          onPointerMove={onOrbMove}
          onPointerLeave={onOrbLeave}
          style={{ x: magX, y: magY }}
          whileTap={{ scale: 0.9 }}
          aria-label={isTask ? taskLabel : messageLabel}
          className={cn(
            "chat-send-orb relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity",
            canSend ? "opacity-100" : "opacity-40",
          )}
        >
          {isTask ? (
            <Sparkles className={cn("h-4 w-4 transition-transform", sending && "animate-pulse")} aria-hidden />
          ) : (
            <ArrowUp className={cn("h-4 w-4 transition-transform", sending && "animate-pulse")} aria-hidden />
          )}
        </motion.button>
      </div>
    </form>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors",
        active
          ? "bg-[var(--accent-line)] text-white"
          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

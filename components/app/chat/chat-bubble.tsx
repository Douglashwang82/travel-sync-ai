"use client";

/**
 * A depth-aware conversation chip for the "Living Canvas" redesign. Three roles:
 *
 *   mine   — springs in from the lower-right; aurora-tinted, elevated.
 *   member — springs in from the lower-left; raised paper chip.
 *   agent  — the AI planner; display-font identity with a gradient name, a
 *            soft aurora-edged surface, and word-by-word streaming for live
 *            messages. The agent's text is treated as the subject, not a peer
 *            of member chatter — that's the whole point of an agentic surface.
 *
 * Each bubble shows the sender's avatar (a real photo when available, otherwise
 * a colored initial; a gradient orb for the AI). Bubbles carry real elevation so
 * they read as physical chips floating over the surface rather than flat
 * rectangles. Entrance springs reuse the shared motion tokens.
 *
 * Bubbles are also interactive chips: click or Tab to "focus" one (a single
 * selected bubble lifts with an accent ring; arrow keys move focus, Esc clears),
 * and every bubble can be dragged to reorder within the conversation. Workable
 * bubbles additionally carry the grids-rail drag payload — the drop target
 * decides (sibling = reorder, rail = create grid).
 */

import { motion } from "motion/react";
import { Sparkles, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/components/motion/variants";
import { StreamingText } from "@/components/app/chat/streaming-text";

export type BubbleRole = "mine" | "member" | "agent";

export function ChatBubble({
  role,
  content,
  author,
  avatarUrl,
  avatarLabel,
  stream = false,
  task = null,
  draggable = false,
  focused = false,
  dragging = false,
  dropIndicator = null,
  dispatched = false,
  dispatchedLabel = "Dispatched",
  onInspect,
  onSelect,
  onKeyNav,
  onDragStart,
  onDragEnd,
  onReorderOver,
  onReorderDrop,
  registerRef,
  children,
}: {
  role: BubbleRole;
  content: string;
  /** Shown above incoming bubbles (member name or the AI planner label). */
  author?: string;
  /** Sender photo URL, if any. */
  avatarUrl?: string | null;
  /** Fallback initial source when there's no photo. */
  avatarLabel?: string;
  /** Stream (typewrite) the body — only meaningful for live agent messages. */
  stream?: boolean;
  /**
   * When the message is "agent-workable", a chip is shown and the bubble can be
   * dragged onto the grids rail. `null` = not workable (or not yet classified).
   */
  task?: { label: string; icon?: string } | null;
  /** Enable native drag (reorder for any bubble; rail drop when workable). */
  draggable?: boolean;
  /** Whether this is the currently-selected bubble (accent ring + lift). */
  focused?: boolean;
  /** True while this is the bubble being dragged — dim it. */
  dragging?: boolean;
  /** Render a reorder insertion line just before/after this bubble. */
  dropIndicator?: "before" | "after" | null;
  /** Already handed to the AI planner — highlighted, and drag is locked. */
  dispatched?: boolean;
  /** Localized label for the dispatched chip. */
  dispatchedLabel?: string;
  /** Fired on hover/focus so the parent can lazily classify this message. */
  onInspect?: () => void;
  /** Click/keyboard selects this bubble as the focused one. */
  onSelect?: () => void;
  /** Arrow/Escape navigation between bubbles (parent moves DOM focus). */
  onKeyNav?: (dir: "up" | "down" | "escape") => void;
  /** Native drag handlers (the parent sets the dataTransfer payload). */
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  /** Reorder drop-target handlers, fired on the whole row. */
  onReorderOver?: (e: React.DragEvent<HTMLLIElement>) => void;
  onReorderDrop?: (e: React.DragEvent<HTMLLIElement>) => void;
  /** Registers the focusable element so the parent can move focus by keyboard. */
  registerRef?: (el: HTMLDivElement | null) => void;
  /** Optional trailing slot (e.g. a read receipt). */
  children?: React.ReactNode;
}) {
  const mine = role === "mine";
  const agent = role === "agent";

  return (
    <motion.li
      initial={{
        opacity: 0,
        y: 12,
        x: mine ? 16 : -16,
        scale: 0.94,
        rotateZ: mine ? 1.2 : -1.2,
      }}
      animate={{
        opacity: dragging ? 0.4 : 1,
        y: focused ? -2 : 0,
        x: 0,
        scale: focused ? 1.02 : 1,
        rotateZ: 0,
      }}
      transition={springSnappy}
      onDragOver={onReorderOver}
      onDrop={onReorderDrop}
      className={cn("relative flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row")}
    >
      {dropIndicator && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-6 z-10 h-0.5 rounded-full bg-[var(--accent-line)]",
            dropIndicator === "before" ? "-top-2" : "-bottom-2",
          )}
        />
      )}

      <BubbleAvatar role={role} url={avatarUrl} label={avatarLabel ?? author} />

      <div
        ref={registerRef}
        className={cn(
          "chat-bubble-wrap flex min-w-0 max-w-[78%] flex-col",
          mine ? "items-end" : "items-start",
          draggable && "cursor-grab active:cursor-grabbing",
        )}
        draggable={draggable || undefined}
        onDragStart={draggable ? onDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        onMouseEnter={onInspect}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.();
        }}
        onFocus={() => {
          onInspect?.();
          onSelect?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect?.();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            onKeyNav?.("down");
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onKeyNav?.("up");
          } else if (e.key === "Escape") {
            onKeyNav?.("escape");
          }
        }}
        tabIndex={0}
        role="button"
        aria-pressed={focused}
      >
        {author && !mine && (
          <span
            className={cn(
              "mb-1 inline-flex items-center gap-1 px-1 text-[10px] font-semibold tracking-tight",
              agent
                ? "text-gradient [font-family:var(--font-display)]"
                : "text-[var(--text-faint)]",
            )}
          >
            {author}
          </span>
        )}

        <div
          data-focused={focused || undefined}
          data-dispatched={dispatched || undefined}
          className={cn(
            "chat-bubble relative w-fit max-w-full px-3.5 py-2.5 text-sm leading-relaxed",
            mine
              ? "chat-bubble--mine text-white"
              : agent
                ? "chat-bubble--agent text-[var(--text-primary)]"
                : "chat-bubble--member text-[var(--text-primary)]",
          )}
        >
          <StreamingText text={content} stream={stream && agent} />
        </div>

        {dispatched ? (
          <span
            className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--status-settled)] bg-[var(--status-settled-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--status-settled)]",
              mine ? "self-end" : "self-start",
            )}
            title="Dispatched to the AI planner"
          >
            <Check className="h-3 w-3" aria-hidden />
            {dispatchedLabel}
          </span>
        ) : (
          task && (
            <span
              className={cn(
                "mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--accent-line)] bg-[var(--accent-line-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-line)]",
                mine ? "self-end" : "self-start",
              )}
              title="Drag onto the grids rail to track this"
            >
              {task.icon ? (
                <span aria-hidden>{task.icon}</span>
              ) : (
                <Sparkles className="h-3 w-3" aria-hidden />
              )}
              {task.label}
            </span>
          )
        )}

        {children}
      </div>
    </motion.li>
  );
}

function BubbleAvatar({
  role,
  url,
  label,
}: {
  role: BubbleRole;
  url?: string | null;
  label?: string;
}) {
  if (role === "agent") {
    return (
      <span aria-hidden className="chat-avatar chat-avatar--agent">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </span>
    );
  }
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="chat-avatar object-cover" />;
  }
  // Nothing to show (e.g. my own DM messages) — skip the avatar entirely.
  if (!label?.trim()) return null;
  const initial = label.trim().slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "chat-avatar items-center justify-center text-[11px] font-semibold",
        role === "mine"
          ? "bg-[var(--accent-line-soft)] text-[var(--accent-line)]"
          : "bg-[var(--surface-sunken)] text-[var(--text-secondary)]",
      )}
    >
      {initial}
    </span>
  );
}

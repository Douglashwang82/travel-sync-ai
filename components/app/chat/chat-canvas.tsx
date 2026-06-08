"use client";

/**
 * The scroll container for the conversation. A clean, flat surface that matches
 * the main app background — depth now comes from the bubbles' own elevation and
 * the foreground proposal widget, not a background gradient. The ref is
 * forwarded to the parent for auto-scroll.
 */

import { cn } from "@/lib/utils";

export function ChatCanvas({
  scrollerRef,
  className,
  children,
}: {
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="chat-canvas relative flex-1 overflow-hidden">
      <div
        ref={scrollerRef}
        aria-live="polite"
        className={cn("relative z-10 h-full overflow-y-auto px-4 py-4", className)}
      >
        {children}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { cn } from "@/lib/utils";

/**
 * Scroll-spy anchor nav. Replaces the previous router-based tab strip:
 * every "tab" now scrolls to a bento grid section on the same page rather
 * than navigating to a separate route. The active pill updates as the
 * user scrolls past each tile.
 */

const COPY = {
  en: {
    overview: "Overview",
    itinerary: "Itinerary",
    budget: "Budget",
    tasks: "Tasks",
    ideas: "Ideas",
    votes: "Votes",
    map: "Map",
    pack: "Pack",
    members: "Members",
    aria: "Trip workspace sections",
  },
  "zh-TW": {
    overview: "總覽",
    itinerary: "行程",
    budget: "預算",
    tasks: "任務",
    ideas: "靈感",
    votes: "投票",
    map: "地圖",
    pack: "打包",
    members: "成員",
    aria: "旅程工作區區段",
  },
} as const;

const SECTIONS = [
  { id: "hero", labelKey: "overview" as const },
  { id: "itinerary", labelKey: "itinerary" as const },
  { id: "budget", labelKey: "budget" as const },
  { id: "tasks", labelKey: "tasks" as const },
  { id: "ideas", labelKey: "ideas" as const },
  { id: "votes", labelKey: "votes" as const },
  { id: "map", labelKey: "map" as const },
  { id: "pack", labelKey: "pack" as const },
  { id: "members", labelKey: "members" as const },
];

export function TripTabs({ tripId }: { tripId: string }) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState<string>("hero");

  // Sticky background flips on once the nav reaches the top.
  useEffect(() => {
    function handler() {
      const top = navRef.current?.getBoundingClientRect().top ?? 0;
      setScrolled(top <= 1);
    }
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Scroll-spy: pick the section whose top is closest to (just below) the nav.
  useEffect(() => {
    function update() {
      const navHeight = navRef.current?.getBoundingClientRect().height ?? 0;
      const probe = navHeight + 24;
      let current: string = SECTIONS[0]!.id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - probe <= 0) current = s.id;
      }
      setActiveId(current);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  function go(id: string, e: React.MouseEvent | React.KeyboardEvent) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Update the URL hash without triggering a full navigation.
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
    // Best-effort focus for keyboard users.
    el.focus({ preventScroll: true });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    const links = Array.from(
      navRef.current?.querySelectorAll<HTMLAnchorElement>('a[role="tab"]') ?? []
    );
    const idx = links.indexOf(target as HTMLAnchorElement);
    if (idx < 0) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      links[(idx + 1) % links.length]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      links[(idx - 1 + links.length) % links.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      links[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      links[links.length - 1]?.focus();
    }
  }

  // `tripId` and `router` are unused now that nav is in-page; reference
  // them so existing callers don't have to change shape.
  void tripId;
  void router;

  return (
    <nav
      ref={navRef}
      role="tablist"
      aria-label={copy.aria}
      onKeyDown={onKeyDown}
      className={cn(
        "sticky top-0 z-30 -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 py-2 transition-[background-color,backdrop-filter,box-shadow,border-color] duration-200",
        scrolled
          ? "surface-glass border-b border-[var(--surface-glass-edge)] shadow-[var(--shadow-flat)]"
          : "border-b border-[var(--border-hairline)] bg-[var(--surface-base)]"
      )}
    >
      {SECTIONS.map((s) => {
        const active = activeId === s.id;
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={(e) => go(s.id, e)}
            className={cn(
              "relative whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2",
              active
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            {copy[s.labelKey]}
            {active && (
              <span
                aria-hidden
                className="absolute -bottom-2 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-[var(--accent-line)]"
                style={{ boxShadow: "var(--accent-line-glow)" }}
              />
            )}
          </a>
        );
      })}
    </nav>
  );
}

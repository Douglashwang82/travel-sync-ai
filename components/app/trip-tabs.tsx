"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { cn } from "@/lib/utils";

const COPY = {
  en: {
    overview: "Overview",
    map: "Map",
    itinerary: "Itinerary",
    ideas: "Ideas",
    votes: "Votes",
    expenses: "Expenses",
    board: "Board",
    settings: "Settings",
  },
  "zh-TW": {
    overview: "總覽",
    map: "地圖",
    itinerary: "行程",
    ideas: "靈感",
    votes: "投票",
    expenses: "費用",
    board: "看板",
    settings: "設定",
  },
} as const;

export function TripTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const base = `/app/trips/${tripId}`;
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handler() {
      const top = navRef.current?.getBoundingClientRect().top ?? 0;
      setScrolled(top <= 1);
    }
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const tabs = [
    { href: base, label: copy.overview, match: (p: string) => p === base },
    { href: `${base}/map`, label: copy.map, match: (p: string) => p.startsWith(`${base}/map`) },
    { href: `${base}/itinerary`, label: copy.itinerary, match: (p: string) => p.startsWith(`${base}/itinerary`) },
    { href: `${base}/ideas`, label: copy.ideas, match: (p: string) => p.startsWith(`${base}/ideas`) },
    { href: `${base}/votes`, label: copy.votes, match: (p: string) => p.startsWith(`${base}/votes`) },
    { href: `${base}/expenses`, label: copy.expenses, match: (p: string) => p.startsWith(`${base}/expenses`) },
    { href: `${base}/board`, label: copy.board, match: (p: string) => p.startsWith(`${base}/board`) },
    { href: `${base}/settings`, label: copy.settings, match: (p: string) => p.startsWith(`${base}/settings`) },
  ] as const;

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

  return (
    <nav
      ref={navRef}
      role="tablist"
      aria-label="Trip workspace sections"
      onKeyDown={onKeyDown}
      className={cn(
        "sticky top-0 z-30 -mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 py-2 transition-[background-color,backdrop-filter,box-shadow,border-color] duration-200",
        scrolled
          ? "surface-glass border-b border-[var(--surface-glass-edge)] shadow-[var(--shadow-flat)]"
          : "border-b border-[var(--border-hairline)] bg-[var(--surface-base)]"
      )}
    >
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            prefetch
            className={cn(
              "relative whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-2",
              active
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            {t.label}
            {active && (
              <span
                aria-hidden
                className="absolute -bottom-2 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-[var(--accent-line)]"
                style={{ boxShadow: "var(--accent-line-glow)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

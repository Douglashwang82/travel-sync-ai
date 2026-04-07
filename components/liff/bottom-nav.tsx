"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/liff/dashboard", label: "Board",     emoji: "🗂️" },
  { href: "/liff/itinerary", label: "Itinerary", emoji: "🗺️" },
  { href: "/liff/expenses",  label: "Expenses",  emoji: "💰" },
  { href: "/liff/votes",     label: "Votes",     emoji: "🗳️" },
  { href: "/liff/help",      label: "Help",      emoji: "❓" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)]/95 backdrop-blur-sm border-t border-[var(--border)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="max-w-md mx-auto flex items-stretch h-14">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex-1 flex flex-col items-center justify-center gap-0.5",
                "text-[10px] font-medium transition-colors duration-150",
                "active:scale-95 active:opacity-70",
                isActive
                  ? "text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {/* Active indicator bar — top of nav item */}
              {isActive && (
                <span
                  className="absolute top-0 left-3 right-3 h-0.5 rounded-full bg-[var(--primary)]"
                  aria-hidden
                />
              )}
              <span className="text-lg leading-none mt-0.5">{item.emoji}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

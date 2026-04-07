"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/liff/dashboard", label: "Board", emoji: "🗂️" },
  { href: "/liff/itinerary", label: "Itinerary", emoji: "🗺️" },
  { href: "/liff/expenses", label: "Expenses", emoji: "💰" },
  { href: "/liff/votes", label: "Votes", emoji: "🗳️" },
  { href: "/liff/help", label: "Help", emoji: "❓" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)] border-t border-[var(--border)] safe-area-inset-bottom">
      <div className="max-w-md mx-auto flex items-stretch h-14">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                isActive
                  ? "text-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              <span className="text-lg leading-none">{item.emoji}</span>
              <span>{item.label}</span>
              {isActive && (
                <span className="absolute bottom-0 w-6 h-0.5 rounded-full bg-[var(--primary)]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/liff/dashboard", label: "Trips", shortLabel: "Trips" },
  { href: "/liff/itinerary", label: "Itinerary", shortLabel: "Plan" },
  { href: "/liff/route", label: "Route", shortLabel: "Route" },
  { href: "/liff/tickets", label: "Tickets", shortLabel: "Tickets" },
  { href: "/liff/expenses", label: "Expenses", shortLabel: "Money" },
  { href: "/liff/votes", label: "Votes", shortLabel: "Votes" },
  { href: "/liff/readiness", label: "Readiness", shortLabel: "Ready" },
  { href: "/liff/operations", label: "Operations", shortLabel: "Ops" },
  { href: "/liff/help", label: "Help", shortLabel: "Help" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)]/95 backdrop-blur-sm border-t border-[var(--border)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="max-w-md mx-auto h-14 overflow-x-auto scrollbar-none">
        <div className="flex items-stretch min-w-full h-14">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={cn(
                  "relative min-w-[4.5rem] px-2 flex-1 flex flex-col items-center justify-center gap-0.5",
                  "text-[10px] font-medium transition-colors duration-150",
                  "active:scale-95 active:opacity-70",
                  isActive
                    ? "text-[var(--primary)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                {isActive && (
                  <span
                    className="absolute top-0 left-3 right-3 h-0.5 rounded-full bg-[var(--primary)]"
                    aria-hidden
                  />
                )}
                <span className="text-[11px] uppercase tracking-wide opacity-70">
                  {item.shortLabel}
                </span>
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

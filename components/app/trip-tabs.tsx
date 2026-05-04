"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function TripTabs({ tripId }: { tripId: string }) {
  const pathname = usePathname();
  const base = `/app/trips/${tripId}`;

  const tabs = [
    { href: base, label: "Workspace", match: (p: string) => p === base },
    {
      href: `${base}/itinerary`,
      label: "Itinerary",
      match: (p: string) => p.startsWith(`${base}/itinerary`),
    },
    {
      href: `${base}/votes`,
      label: "Votes",
      match: (p: string) => p.startsWith(`${base}/votes`),
    },
    {
      href: `${base}/expenses`,
      label: "Expenses",
      match: (p: string) => p.startsWith(`${base}/expenses`),
    },
    {
      href: `${base}/board`,
      label: "Board",
      match: (p: string) => p.startsWith(`${base}/board`),
    },
    {
      href: `${base}/settings`,
      label: "Settings",
      match: (p: string) => p.startsWith(`${base}/settings`),
    },
  ] as const;

  return (
    <nav className="flex w-full overflow-x-auto border-b border-[var(--border)] text-sm">
      {tabs.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "border-b-2 px-4 py-2.5 font-medium transition-colors -mb-px",
              active
                ? "border-[var(--primary)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

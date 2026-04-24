"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { appFetchJson } from "@/lib/app-client";

export function InboxNavLink() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCount() {
      try {
        const res = await appFetchJson<{ count: number }>(
          "/api/app/notifications/unread-count"
        );
        if (!cancelled) setCount(res.count);
      } catch {
        // Silent — don't surface errors in the header
      }
    }

    void fetchCount();
    // Refresh on tab focus so the badge reflects new notifications
    const onFocus = () => void fetchCount();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <Link
      href="/app/inbox"
      className="relative flex items-center text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
    >
      <span className="hidden sm:inline">Inbox</span>
      <span aria-hidden className="sm:hidden">✉</span>
      {count != null && count > 0 && (
        <span
          aria-label={`${count} unread notifications`}
          className="ml-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-[var(--primary)] px-1.5 text-[10px] font-semibold leading-tight text-[var(--primary-foreground)]"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

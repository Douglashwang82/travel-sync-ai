import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/db";
import { APP_SESSION_COOKIE } from "@/lib/app-server";
import { AppHeaderUser } from "@/components/app/app-header-user";
import { InboxNavLink } from "@/components/app/inbox-nav-link";

export const metadata = {
  title: "TravelSync — Trip workspace",
  description: "Plan, decide, and settle up for your group trip from any browser.",
};

async function getSignedInUser(): Promise<{
  lineUserId: string;
  displayName: string | null;
} | null> {
  const jar = await cookies();
  const lineUserId = jar.get(APP_SESSION_COOKIE)?.value;
  if (!lineUserId) return null;

  const db = createAdminClient();
  const { data } = await db
    .from("group_members")
    .select("display_name")
    .eq("line_user_id", lineUserId)
    .is("left_at", null)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    lineUserId,
    displayName: (data?.display_name as string | null) ?? null,
  };
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSignedInUser();

  return (
    <div className="min-h-screen bg-[var(--secondary)]/40 dark:bg-[#0a0a0a]">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/app"
            className="flex items-center gap-2 text-sm font-bold tracking-tight text-[var(--foreground)]"
          >
            <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-auto logo-animated" priority />
            <span className="text-[var(--primary)]">TravelSync</span>
            <span className="hidden text-[var(--muted-foreground)] sm:inline">·</span>
            <span className="hidden text-[var(--muted-foreground)] sm:inline">Workspace</span>
          </Link>

          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/app"
              className="hidden text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:block"
            >
              Trips
            </Link>
            <Link
              href="/app/templates"
              className="hidden text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:block"
            >
              Templates
            </Link>
            <Link
              href="/"
              className="hidden text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:block"
            >
              Home
            </Link>
            {user && <InboxNavLink />}
            <AppHeaderUser user={user} />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

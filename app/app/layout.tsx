import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/db";
import { APP_SESSION_COOKIE } from "@/lib/app-server";
import { parseAppLocale } from "@/lib/app-locale";
import { AppLocaleProvider } from "@/components/app/app-locale-provider";
import { AppLanguageToggle } from "@/components/app/app-language-toggle";
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
  const locale = parseAppLocale((await cookies()).get("travelsync-app-locale")?.value);
  const copy =
    locale === "zh-TW"
      ? {
          workspace: "工作區",
          trips: "旅程",
          templates: "範本",
          home: "首頁",
        }
      : {
          workspace: "Workspace",
          trips: "Trips",
          templates: "Templates",
          home: "Home",
        };

  return (
    <AppLocaleProvider initialLocale={locale}>
      <div className="min-h-screen bg-[var(--secondary)]/40 dark:bg-[#0a0a0a]">
        <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-0">
            <Link
              href="/app"
              className="flex min-w-0 items-center gap-2 text-sm font-bold tracking-tight text-[var(--foreground)]"
            >
              <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-auto logo-animated" priority />
              <span className="text-[var(--primary)]">TravelSync</span>
              <span className="hidden text-[var(--muted-foreground)] sm:inline">·</span>
              <span className="hidden text-[var(--muted-foreground)] sm:inline">{copy.workspace}</span>
            </Link>

            <nav className="flex w-full min-w-0 flex-wrap items-center justify-between gap-3 text-sm sm:w-auto sm:flex-nowrap sm:justify-end sm:gap-4">
              <Link
                href="/app"
                className="hidden text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:block"
              >
                {copy.trips}
              </Link>
              <Link
                href="/app/templates"
                className="hidden text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:block"
              >
                {copy.templates}
              </Link>
              <Link
                href="/"
                className="hidden text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:block"
              >
                {copy.home}
              </Link>
              <AppLanguageToggle />
              {user && <InboxNavLink />}
              <AppHeaderUser user={user} />
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </AppLocaleProvider>
  );
}

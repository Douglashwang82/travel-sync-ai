import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/db";
import { APP_SESSION_COOKIE } from "@/lib/app-server";
import { parseAppLocale } from "@/lib/app-locale";
import { AppLocaleProvider } from "@/components/app/app-locale-provider";
import { AppShell } from "@/components/app/app-shell";

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

  return (
    <AppLocaleProvider initialLocale={locale}>
      <AppShell user={user}>{children}</AppShell>
    </AppLocaleProvider>
  );
}

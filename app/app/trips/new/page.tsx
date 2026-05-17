import type { ReactElement } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/db";
import { readAppSessionCookie } from "@/lib/app-server";
import { NewTripWizard } from "./wizard-client";

// Web wizard for trip generation. See design/trip-generation.md.
//
// Server-side shell pulls auth + the user's eligible groups, then hands off
// to a client component that walks the user through the 8-question survey
// and POSTs to /api/app/trips/generate on submit.

export const metadata = {
  title: "Plan a new trip — TravelSync",
  description: "Answer a few must-haves and we'll draft your trip.",
};

export const dynamic = "force-dynamic";

interface GroupOption {
  id: string;
  name: string;
}

export default async function NewTripPage(): Promise<ReactElement> {
  const lineUserId = await readAppSessionCookie();
  if (!lineUserId) {
    redirect("/app/sign-in?next=/app/trips/new");
  }

  const db = createAdminClient();
  const { data: memberships } = await db
    .from("group_members")
    .select("group_id, line_groups!inner(id, name, status)")
    .eq("line_user_id", lineUserId)
    .is("left_at", null);

  const groups: GroupOption[] = (memberships ?? [])
    .map((m) => {
      const g = Array.isArray(m.line_groups) ? m.line_groups[0] : m.line_groups;
      if (!g) return null;
      if ((g.status as string) === "removed") return null;
      return { id: g.id as string, name: (g.name as string | null) ?? "未命名群組" };
    })
    .filter((g): g is GroupOption => g != null);

  return <NewTripWizard groups={groups} />;
}

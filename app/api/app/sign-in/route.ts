import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import {
  clearAppSessionCookie,
  setAppSessionCookie,
} from "@/lib/app-server";
import { isLineLoginConfigured } from "@/lib/app-line-login";
import { ensureAppUserForLineId } from "@/lib/app-users";

/**
 * Dev sign-in helper for the browser /app experience.
 *
 * GET  — list every active group member so the picker can render choices.
 * POST — accept { lineUserId } and stamp the session cookie.
 * DELETE — sign out.
 *
 * Locked down in production when LINE Login is configured — otherwise the
 * picker would remain an impersonation backdoor. DELETE remains open so
 * signed-in users can always sign themselves out.
 */

function devPickerDisabled(): boolean {
  return process.env.NODE_ENV === "production" && isLineLoginConfigured();
}

function disabledResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Dev sign-in is disabled in production. Use LINE Login instead.",
      code: "DEV_SIGNIN_DISABLED",
    },
    { status: 404 }
  );
}

const SignInSchema = z.object({
  lineUserId: z.string().min(1),
});

export interface SignInMember {
  lineUserId: string;
  displayName: string | null;
  email: string | null;
  role: string;
  groups: Array<{
    groupId: string;
    groupName: string | null;
    lineGroupId: string;
  }>;
}

export async function GET(): Promise<NextResponse> {
  if (devPickerDisabled()) return disabledResponse();

  const db = createAdminClient();
  const [{ data: memberRows, error: membersError }, { data: appUserRows, error: usersError }] =
    await Promise.all([
      db
        .from("group_members")
        .select(
          "line_user_id, display_name, role, joined_at, group_id, line_groups!inner(id, line_group_id, name, status)"
        )
        .is("left_at", null)
        .order("joined_at", { ascending: false })
        .order("display_name", { ascending: true }),
      db
        .from("app_users")
        .select("email, display_name, line_user_id, created_at")
        .order("created_at", { ascending: false }),
    ]);

  if (membersError || usersError) {
    return NextResponse.json(
      { error: "Failed to load members", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const membersByLineUserId = new Map<string, SignInMember>();

  for (const row of memberRows ?? []) {
    const group = Array.isArray(row.line_groups) ? row.line_groups[0] : row.line_groups;
    const lineUserId = row.line_user_id as string;
    const existing = membersByLineUserId.get(lineUserId);
    const groupSummary = {
      groupId: row.group_id as string,
      groupName: (group?.name as string | null) ?? null,
      lineGroupId: (group?.line_group_id as string) ?? "",
    };

    if (!existing) {
      membersByLineUserId.set(lineUserId, {
        lineUserId,
        displayName: row.display_name as string | null,
        email: null,
        role: row.role as string,
        groups: [groupSummary],
      });
      continue;
    }

    if (!existing.groups.some((candidate) => candidate.groupId === groupSummary.groupId)) {
      existing.groups.push(groupSummary);
    }

    if (existing.displayName == null && row.display_name != null) {
      existing.displayName = row.display_name as string;
    }

    if (existing.role !== "organizer" && row.role === "organizer") {
      existing.role = "organizer";
    }
  }

  for (const row of appUserRows ?? []) {
    const lineUserId = row.line_user_id as string;
    const displayName = (row.display_name as string | null) ?? null;
    const email = (row.email as string | null) ?? null;
    const existing = membersByLineUserId.get(lineUserId);

    if (!existing) {
      membersByLineUserId.set(lineUserId, {
        lineUserId,
        displayName,
        email,
        role: "member",
        groups: [],
      });
      continue;
    }

    if (existing.displayName == null && displayName != null) {
      existing.displayName = displayName;
    }
    if (existing.email == null && email != null) {
      existing.email = email;
    }
  }

  const members = Array.from(membersByLineUserId.values()).sort((left, right) => {
    const leftName = (left.displayName ?? left.email ?? left.lineUserId).toLowerCase();
    const rightName = (right.displayName ?? right.email ?? right.lineUserId).toLowerCase();
    return leftName.localeCompare(rightName);
  });

  return NextResponse.json({ members });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (devPickerDisabled()) return disabledResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = SignInSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR" },
      { status: 400 }
    );
  }

  const db = createAdminClient();
  const { data: member } = await db
    .from("group_members")
    .select("line_user_id, display_name")
    .eq("line_user_id", parsed.data.lineUserId)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  if (member) {
    // Ensure a corresponding `app_users` row exists so `requireAppUser` can
    // resolve the cookie back to a known identity.
    const appUser = await ensureAppUserForLineId(
      parsed.data.lineUserId,
      (member.display_name as string | null) ?? null
    );
    if (!appUser) {
      return NextResponse.json(
        { error: "Failed to materialize app user", code: "DB_ERROR" },
        { status: 500 }
      );
    }
  } else {
    const { data: appUser } = await db
      .from("app_users")
      .select("id")
      .eq("line_user_id", parsed.data.lineUserId)
      .maybeSingle();

    if (!appUser) {
      return NextResponse.json(
        {
          error: "User is not a member of any active group or registered app user",
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }
  }

  const res = NextResponse.json({ ok: true, lineUserId: parsed.data.lineUserId });
  setAppSessionCookie(res, parsed.data.lineUserId);
  return res;
}

export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  clearAppSessionCookie(res);
  return res;
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import {
  clearAppSessionCookie,
  setAppSessionCookie,
} from "@/lib/app-server";
import { isLineLoginConfigured } from "@/lib/app-line-login";

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
  role: string;
  groupId: string;
  groupName: string | null;
  lineGroupId: string;
}

export async function GET(): Promise<NextResponse> {
  if (devPickerDisabled()) return disabledResponse();

  const db = createAdminClient();
  const { data, error } = await db
    .from("group_members")
    .select(
      "line_user_id, display_name, role, group_id, line_groups!inner(id, line_group_id, name, status)"
    )
    .is("left_at", null)
    .order("display_name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load members", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const members: SignInMember[] = (data ?? []).map((row) => {
    const group = Array.isArray(row.line_groups) ? row.line_groups[0] : row.line_groups;
    return {
      lineUserId: row.line_user_id as string,
      displayName: row.display_name as string | null,
      role: row.role as string,
      groupId: row.group_id as string,
      groupName: (group?.name as string | null) ?? null,
      lineGroupId: (group?.line_group_id as string) ?? "",
    };
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
    .select("line_user_id")
    .eq("line_user_id", parsed.data.lineUserId)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  if (!member) {
    return NextResponse.json(
      { error: "User is not a member of any active group", code: "NOT_FOUND" },
      { status: 404 }
    );
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

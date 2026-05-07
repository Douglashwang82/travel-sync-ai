import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { setAppSessionCookie } from "@/lib/app-server";
import { hashPassword } from "@/lib/passwords";
import { findAppUserByEmail, generateSyntheticLineUserId } from "@/lib/app-users";

const RegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80),
});

/**
 * POST /api/app/auth/register
 *
 * Creates an `app_users` row backed by an email + scrypt password hash and
 * stamps the session cookie. The session cookie still carries a `line_user_id`
 * — for email-only registrations we generate a synthetic id so all downstream
 * tables keep working without branching on identity provider.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const { email, password, displayName } = parsed.data;

  const existing = await findAppUserByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists.", code: "EMAIL_TAKEN" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const lineUserId = generateSyntheticLineUserId();

  const db = createAdminClient();
  const { data: created, error } = await db
    .from("app_users")
    .insert({
      email,
      password_hash: passwordHash,
      display_name: displayName,
      line_user_id: lineUserId,
    })
    .select("id, email, display_name, line_user_id")
    .single();

  if (error || !created) {
    // Most likely cause: a concurrent insert with the same email.
    return NextResponse.json(
      { error: "Failed to register. Please try again.", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const res = NextResponse.json({
    ok: true,
    user: {
      id: created.id as string,
      email: created.email as string,
      displayName: created.display_name as string | null,
    },
  });
  setAppSessionCookie(res, created.line_user_id as string);
  return res;
}

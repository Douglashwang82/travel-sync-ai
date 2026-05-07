import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setAppSessionCookie } from "@/lib/app-server";
import { verifyPassword } from "@/lib/passwords";
import { findAppUserByEmail } from "@/lib/app-users";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

/**
 * POST /api/app/auth/login
 *
 * Verifies an email/password pair against `app_users` and stamps the session
 * cookie with the user's stored `line_user_id`. Returns a generic error for
 * both unknown-email and bad-password to avoid an account-enumeration oracle.
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

  const parsed = LoginSchema.safeParse(body);
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

  const { email, password } = parsed.data;

  const user = await findAppUserByEmail(email);
  if (!user || !user.password_hash) {
    return NextResponse.json(
      { error: "Invalid email or password.", code: "INVALID_CREDENTIALS" },
      { status: 401 }
    );
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return NextResponse.json(
      { error: "Invalid email or password.", code: "INVALID_CREDENTIALS" },
      { status: 401 }
    );
  }

  const res = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
    },
  });
  setAppSessionCookie(res, user.line_user_id);
  return res;
}

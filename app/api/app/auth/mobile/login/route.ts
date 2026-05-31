import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyPassword } from "@/lib/passwords";
import { findAppUserByEmail } from "@/lib/app-users";
import { issueMobileTokens } from "@/lib/app-tokens";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

/**
 * POST /api/app/auth/mobile/login
 *
 * Email/password login for the native mobile app. Mirrors the web
 * `/api/app/auth/login` flow but, instead of stamping the HttpOnly session
 * cookie (which native clients can't use), returns a signed access + refresh
 * token pair. Clients store these in the device keychain and send the access
 * token as `Authorization: Bearer <token>` on subsequent requests.
 *
 * Returns a generic error for both unknown-email and bad-password to avoid an
 * account-enumeration oracle.
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

  const tokens = issueMobileTokens(user.line_user_id);
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
    ...tokens,
  });
}

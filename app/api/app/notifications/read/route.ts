import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { markNotificationsRead } from "@/services/notifications";

const BodySchema = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), {
    message: "Provide ids[] or { all: true }",
  });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const ids = parsed.data.all ? undefined : parsed.data.ids;
  const result = await markNotificationsRead(auth.lineUserId, ids);
  return NextResponse.json(result);
}

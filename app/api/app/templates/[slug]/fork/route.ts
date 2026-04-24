import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { forkTemplate } from "@/services/templates";

const ForkSchema = z.object({
  groupId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

type RouteContext = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = ForkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await forkTemplate({
    slug,
    groupId: parsed.data.groupId,
    startDate: parsed.data.startDate,
    lineUserId: auth.lineUserId,
  });

  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : result.code === "CONFLICT" ? 409
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({ tripId: result.data.tripId }, { status: 201 });
}

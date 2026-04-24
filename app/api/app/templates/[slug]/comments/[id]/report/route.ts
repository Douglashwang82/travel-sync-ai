import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { reportComment } from "@/services/templates";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

const Schema = z.object({
  reason: z.string().min(1).max(1000),
});

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await reportComment(slug, id, auth.lineUserId, parsed.data.reason);
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "VALIDATION_ERROR" ? 400
      : result.code === "RATE_LIMITED" ? 429
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(result.data, { status: 201 });
}

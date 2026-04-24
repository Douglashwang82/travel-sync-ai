import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { deleteComment, updateComment } from "@/services/templates";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

const PatchSchema = z.object({
  body: z.string().min(1).max(2000),
});

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await updateComment(slug, id, auth.lineUserId, parsed.data.body);
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : result.code === "CONFLICT" ? 409
      : result.code === "VALIDATION_ERROR" ? 400
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(result.data);
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const result = await deleteComment(slug, id, auth.lineUserId);
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return new NextResponse(null, { status: 204 });
}

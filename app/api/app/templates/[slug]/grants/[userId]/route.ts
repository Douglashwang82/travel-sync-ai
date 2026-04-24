import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { removeTemplateGrant } from "@/services/templates";

type RouteContext = { params: Promise<{ slug: string; userId: string }> };

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug, userId } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const result = await removeTemplateGrant(slug, auth.lineUserId, userId);
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return new NextResponse(null, { status: 204 });
}

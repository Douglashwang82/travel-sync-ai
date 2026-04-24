import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { decideAccessRequest } from "@/services/templates";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug, id } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const result = await decideAccessRequest(slug, id, auth.lineUserId, "denied");
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : result.code === "CONFLICT" ? 409
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(result.data);
}

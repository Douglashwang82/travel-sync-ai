import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { getTemplate } from "@/services/templates";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const result = await getTemplate(slug);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(result.data);
}

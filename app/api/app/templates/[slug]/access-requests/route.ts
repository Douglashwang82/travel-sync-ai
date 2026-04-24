import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { listAccessRequests, requestTemplateAccess } from "@/services/templates";

type RouteContext = { params: Promise<{ slug: string }> };

const PostSchema = z.object({
  message: z.string().max(500).nullable().optional(),
});

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await requestTemplateAccess(
    slug,
    auth.lineUserId,
    parsed.data.message ?? null
  );
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "CONFLICT" ? 409
      : result.code === "VALIDATION_ERROR" ? 400
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(result.data, { status: 201 });
}

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawStatus = url.searchParams.get("status");
  const statusFilter =
    rawStatus === "pending" || rawStatus === "approved" || rawStatus === "denied"
      ? rawStatus
      : undefined;

  const result = await listAccessRequests(slug, auth.lineUserId, statusFilter);
  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(result.data);
}

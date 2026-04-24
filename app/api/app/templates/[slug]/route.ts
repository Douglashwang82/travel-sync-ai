import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { getTemplate, updateTemplate } from "@/services/templates";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const result = await getTemplate(slug, auth.lineUserId);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(result.data);
}

const PatchSchema = z.object({
  visibility: z.enum(["public", "private", "request_only"]).optional(),
});

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { slug } = await ctx.params;
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

  const result = await updateTemplate({
    slug,
    authorLineUserId: auth.lineUserId,
    visibility: parsed.data.visibility,
  });

  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : result.code === "VALIDATION_ERROR" ? 400
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({ template: result.data.template });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppTripAccess } from "@/lib/app-server";
import { publishTemplate } from "@/services/templates";

const PublishSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(1000).nullable().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string().min(1).max(50)).max(10).default([]),
  templateId: z.string().uuid().optional(),
});

type RouteContext = { params: Promise<{ tripId: string }> };

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { tripId } = await ctx.params;
  const auth = await requireAppTripAccess(req, tripId);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = PublishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await publishTemplate({
    tripId,
    authorLineUserId: auth.lineUserId,
    title: parsed.data.title,
    summary: parsed.data.summary ?? null,
    coverImageUrl: parsed.data.coverImageUrl ?? null,
    tags: parsed.data.tags,
    visibility: "public",
    templateId: parsed.data.templateId,
  });

  if (!result.ok) {
    const status =
      result.code === "NOT_FOUND" ? 404
      : result.code === "FORBIDDEN" ? 403
      : result.code === "RATE_LIMITED" ? 429
      : result.code === "NO_CHANGES" ? 409
      : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json(
    {
      template: result.data.template,
      version: result.data.version,
      isNewTemplate: result.data.isNewTemplate,
    },
    { status: result.data.isNewTemplate ? 201 : 200 }
  );
}

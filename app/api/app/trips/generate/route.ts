import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";
import { createAdminClient } from "@/lib/db";
import {
  generateTemplateFromSurvey,
  GenerationFailedError,
  type SurveyAnswers,
} from "@/services/trip-generation";
import { forkTemplate } from "@/services/templates";

// POST /api/app/trips/generate
//
// Web-wizard submit. Generates a private template from completed survey
// answers, immediately forks it into a real trip, and returns the trip id
// for the client to navigate to. On LINE this same flow is two postbacks
// (generate → preview → fork) because the group needs to confirm; on the
// web the bento workspace IS the preview, so we skip the intermediate step.

const BodySchema = z.object({
  groupId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  answers: z.object({
    destination: z.string().min(2).max(120),
    duration_days: z.number().int().min(1).max(30),
    party: z.enum(["solo", "couple", "family", "friends"]),
    party_size: z.number().int().min(1).max(20),
    budget_tier: z.enum(["shoestring", "mid", "luxury"]),
    vibe: z.array(z.enum(["relaxed", "adventure", "culture", "foodie", "nightlife", "nature"])).min(1).max(3),
    pace: z.enum(["chill", "balanced", "packed"]),
    must_haves: z.string().max(500).nullish(),
  }),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", message: err instanceof Error ? err.message : "bad request" },
      { status: 400 }
    );
  }

  // Membership check — only let users fork into a group they're part of.
  const db = createAdminClient();
  const { data: membership } = await db
    .from("group_members")
    .select("group_id")
    .eq("group_id", body.groupId)
    .eq("line_user_id", auth.lineUserId)
    .is("left_at", null)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden", message: "Not a member of this group" }, { status: 403 });
  }

  // 1. Generate the private template
  let templateId: string;
  try {
    const out = await generateTemplateFromSurvey({
      answers: body.answers as SurveyAnswers,
      authorLineUserId: auth.lineUserId,
    });
    templateId = out.templateId;
  } catch (err) {
    if (err instanceof GenerationFailedError) {
      return NextResponse.json(
        { error: "generation_failed", reason: err.reason, message: err.message },
        { status: err.reason === "gemini_unavailable" ? 503 : 422 }
      );
    }
    console.error("[trips/generate] unexpected error", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  // 2. Fork by slug (templates module is slug-keyed)
  const { data: tmpl } = await db
    .from("trip_templates")
    .select("slug")
    .eq("id", templateId)
    .single();
  if (!tmpl) {
    return NextResponse.json({ error: "internal_error", message: "template missing post-create" }, { status: 500 });
  }

  const result = await forkTemplate({
    slug: tmpl.slug as string,
    groupId: body.groupId,
    startDate: body.startDate,
    lineUserId: auth.lineUserId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "fork_failed", message: result.error, code: result.code }, { status: 422 });
  }

  return NextResponse.json({ tripId: result.data.tripId, templateId });
}

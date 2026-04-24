import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { searchTemplates, type TemplateSortOrder } from "@/services/templates";

const ALLOWED_SORTS: readonly TemplateSortOrder[] = ["recent", "forks", "likes"];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const tagsRaw = url.searchParams.get("tags");
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : undefined;
  const durationMin = parseIntParam(url.searchParams.get("durationMin"));
  const durationMax = parseIntParam(url.searchParams.get("durationMax"));
  const sortRaw = url.searchParams.get("sort");
  const sort: TemplateSortOrder = ALLOWED_SORTS.includes(sortRaw as TemplateSortOrder)
    ? (sortRaw as TemplateSortOrder)
    : "recent";
  const limit = parseIntParam(url.searchParams.get("limit")) ?? 20;
  const offset = parseIntParam(url.searchParams.get("offset")) ?? 0;

  const result = await searchTemplates({
    q,
    tags,
    durationMin,
    durationMax,
    sort,
    limit,
    offset,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: 500 });
  }

  return NextResponse.json(result.data);
}

function parseIntParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

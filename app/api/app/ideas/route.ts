import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { searchIdeas, type IdeaSortOrder } from "@/services/ideas";
import type { ItemType } from "@/lib/types";

const ALLOWED_SORTS: readonly IdeaSortOrder[] = ["recent", "popular"];
const ALLOWED_ITEM_TYPES: readonly ItemType[] = [
  "hotel",
  "restaurant",
  "activity",
  "transport",
  "insurance",
  "flight",
  "other",
];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const destination = url.searchParams.get("destination") ?? undefined;

  const itemTypesRaw = url.searchParams.get("itemTypes");
  const itemTypes = itemTypesRaw
    ? itemTypesRaw
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is ItemType =>
          ALLOWED_ITEM_TYPES.includes(t as ItemType)
        )
    : undefined;

  const sortRaw = url.searchParams.get("sort");
  const sort: IdeaSortOrder = ALLOWED_SORTS.includes(sortRaw as IdeaSortOrder)
    ? (sortRaw as IdeaSortOrder)
    : "recent";

  const limit = parseIntParam(url.searchParams.get("limit")) ?? 24;
  const offset = parseIntParam(url.searchParams.get("offset")) ?? 0;

  const result = await searchIdeas({
    q,
    itemTypes,
    destination,
    sort,
    limit,
    offset,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code },
      { status: 500 }
    );
  }

  return NextResponse.json(result.data);
}

function parseIntParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { listNotifications } from "@/services/notifications";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "true";
  const limit = parseIntParam(url.searchParams.get("limit")) ?? 20;
  const offset = parseIntParam(url.searchParams.get("offset")) ?? 0;

  const result = await listNotifications(auth.lineUserId, {
    unreadOnly,
    limit,
    offset,
  });

  return NextResponse.json(result);
}

function parseIntParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "@/lib/app-server";
import { buildPlacePhotoUrl } from "@/services/decisions/places";

type RouteContext = { params: Promise<{ name: string[] }> };

/**
 * GET /api/app/places/photo/{...photoName}?w=600&h=400
 *
 * Proxies a Google Places photo so the API key never reaches the client.
 * `photoName` is the resource path returned by Places (e.g. `places/{id}/photos/{photoId}`)
 * and arrives split into URL segments via the catch-all route param.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  const { name } = await ctx.params;
  if (!name || name.length === 0) {
    return NextResponse.json(
      { error: "Photo name required", code: "MISSING_NAME" },
      { status: 400 },
    );
  }

  const photoName = name.map((seg) => decodeURIComponent(seg)).join("/");
  if (!/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
    return NextResponse.json(
      { error: "Invalid photo name", code: "INVALID_NAME" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const w = clampInt(searchParams.get("w"), 1600, 600);
  const h = clampInt(searchParams.get("h"), 1600, 400);

  const upstream = buildPlacePhotoUrl(photoName, { maxWidthPx: w, maxHeightPx: h });
  if (!upstream) {
    return NextResponse.json(
      { error: "Photo provider not configured", code: "NO_PROVIDER" },
      { status: 503 },
    );
  }

  const res = await fetch(upstream, { cache: "no-store" });
  if (!res.ok || !res.body) {
    return NextResponse.json(
      { error: "Upstream photo fetch failed", code: "UPSTREAM_ERROR" },
      { status: 502 },
    );
  }

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "private, max-age=3600",
    },
  });
}

function clampInt(raw: string | null, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

/**
 * GET /api/home/poi-photo?id=<catalog-poi-id>&w=640 — public photo proxy for
 * the index-page POI media wall.
 *
 * Only ids from the static lib/home-survey catalog are served, so the Google
 * key can never be driven by arbitrary client queries. The resolved photo
 * resource name is cached in-memory per instance; responses carry long-lived
 * cache headers so the CDN absorbs repeat traffic. Returns 404 when no
 * provider key is configured or the place has no photo — the client renders
 * its gradient placeholder instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getHomePoi } from "@/lib/home-survey";
import { buildPlacePhotoUrl, findPlacePhotoName } from "@/services/decisions/places";

export const runtime = "nodejs";

const PHOTO_NAME_TTL_MS = 24 * 60 * 60 * 1000;
const photoNameCache = new Map<string, { name: string | null; at: number }>();

export async function GET(req: NextRequest): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const limit = await checkRateLimit("group", `home-photo:${ip}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  const poi = getHomePoi(id);
  if (!poi) {
    return NextResponse.json({ error: "Unknown POI", code: "UNKNOWN_POI" }, { status: 404 });
  }
  const w = clampInt(searchParams.get("w"), 1200, 640);

  let cached = photoNameCache.get(id);
  if (!cached || Date.now() - cached.at > PHOTO_NAME_TTL_MS) {
    cached = { name: await findPlacePhotoName(poi.photoQuery), at: Date.now() };
    photoNameCache.set(id, cached);
  }
  if (!cached.name) {
    return NextResponse.json({ error: "No photo available", code: "NO_PHOTO" }, { status: 404 });
  }

  const upstream = buildPlacePhotoUrl(cached.name, { maxWidthPx: w });
  if (!upstream) {
    return NextResponse.json({ error: "Photo provider not configured", code: "NO_PROVIDER" }, { status: 404 });
  }

  const res = await fetch(upstream, { cache: "no-store" });
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "Upstream photo fetch failed", code: "UPSTREAM_ERROR" }, { status: 502 });
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "image/jpeg",
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}

function clampInt(raw: string | null, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, n);
}

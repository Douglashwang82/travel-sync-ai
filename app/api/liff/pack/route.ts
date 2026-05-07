import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/db";
import { authenticateLiffRequest, requireTripMembership } from "@/lib/liff-server";
import type { ApiError } from "@/lib/types";

// ─── Personal packing list ────────────────────────────────────────────────────
// Private to the authenticated LINE user. The list is scoped to a trip the
// user has access to (via group membership), but rows are never exposed to
// other group members.

export type PackCategory =
  | "documents"
  | "clothing"
  | "toiletries"
  | "electronics"
  | "health"
  | "general";

export const PACK_CATEGORIES: PackCategory[] = [
  "documents",
  "clothing",
  "toiletries",
  "electronics",
  "health",
  "general",
];

export interface PackItem {
  id: string;
  tripId: string;
  label: string;
  category: PackCategory;
  isPacked: boolean;
  packedAt: string | null;
  position: number;
  createdAt: string;
}

export interface PackListResponse {
  tripId: string;
  startDate: string | null;
  endDate: string | null;
  destinationName: string | null;
  items: PackItem[];
  totalCount: number;
  packedCount: number;
}

const GetSchema = z.object({
  tripId: z.string().uuid(),
});

const CategorySchema = z.enum([
  "documents",
  "clothing",
  "toiletries",
  "electronics",
  "health",
  "general",
]);

const PostSchema = z.object({
  tripId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  category: CategorySchema.default("general"),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const parsed = GetSchema.safeParse({ tripId: searchParams.get("tripId") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const membership = await requireTripMembership(req, parsed.data.tripId);
  if (!membership.ok) return membership.response;

  const db = createAdminClient();
  const { data: trip, error: tripErr } = await db
    .from("trips")
    .select("id, start_date, end_date, destination_name")
    .eq("id", parsed.data.tripId)
    .single();

  if (tripErr || !trip) {
    return NextResponse.json<ApiError>(
      { error: "Trip not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }

  const { data: rows, error } = await db
    .from("personal_packing_items")
    .select("id, trip_id, label, category, is_packed, packed_at, position, created_at")
    .eq("trip_id", parsed.data.tripId)
    .eq("line_user_id", membership.lineUserId)
    .order("is_packed", { ascending: true })
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json<ApiError>(
      { error: "Failed to load packing list", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const items: PackItem[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    tripId: r.trip_id as string,
    label: r.label as string,
    category: r.category as PackCategory,
    isPacked: Boolean(r.is_packed),
    packedAt: (r.packed_at as string | null) ?? null,
    position: Number(r.position ?? 0),
    createdAt: r.created_at as string,
  }));

  return NextResponse.json<PackListResponse>({
    tripId: trip.id as string,
    startDate: (trip.start_date as string | null) ?? null,
    endDate: (trip.end_date as string | null) ?? null,
    destinationName: (trip.destination_name as string | null) ?? null,
    items,
    totalCount: items.length,
    packedCount: items.filter((i) => i.isPacked).length,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authenticateLiffRequest(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiError>(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<ApiError>(
      { error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const membership = await requireTripMembership(req, parsed.data.tripId);
  if (!membership.ok) return membership.response;

  const db = createAdminClient();

  const { data: maxRow } = await db
    .from("personal_packing_items")
    .select("position")
    .eq("trip_id", parsed.data.tripId)
    .eq("line_user_id", membership.lineUserId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (Number(maxRow?.position ?? 0) || 0) + 1;

  const { data: inserted, error } = await db
    .from("personal_packing_items")
    .insert({
      trip_id: parsed.data.tripId,
      line_user_id: membership.lineUserId,
      label: parsed.data.label,
      category: parsed.data.category,
      position: nextPosition,
    })
    .select("id, trip_id, label, category, is_packed, packed_at, position, created_at")
    .single();

  if (error || !inserted) {
    return NextResponse.json<ApiError>(
      { error: "Failed to add item", code: "DB_ERROR" },
      { status: 500 }
    );
  }

  const item: PackItem = {
    id: inserted.id as string,
    tripId: inserted.trip_id as string,
    label: inserted.label as string,
    category: inserted.category as PackCategory,
    isPacked: Boolean(inserted.is_packed),
    packedAt: (inserted.packed_at as string | null) ?? null,
    position: Number(inserted.position ?? 0),
    createdAt: inserted.created_at as string,
  };

  return NextResponse.json(item, { status: 201 });
}

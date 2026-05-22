import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";

export type TravelMode = "WALK" | "DRIVE" | "BICYCLE" | "TRANSIT";

export interface DirectionsLeg {
  distanceMeters: number;
  durationSeconds: number;
}

export interface DirectionsResponse {
  legs: DirectionsLeg[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  polyline: string | null;
  mode: TravelMode;
}

const LatLngSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

const BodySchema = z.object({
  origin: LatLngSchema,
  destination: LatLngSchema,
  waypoints: z.array(LatLngSchema).max(20).optional(),
  mode: z.enum(["WALK", "DRIVE", "BICYCLE", "TRANSIT"]).optional(),
});

interface RoutesApiLeg {
  distanceMeters?: number;
  duration?: string;
}

interface RoutesApiRoute {
  distanceMeters?: number;
  duration?: string;
  polyline?: { encodedPolyline?: string };
  legs?: RoutesApiLeg[];
}

const FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.polyline.encodedPolyline",
  "routes.legs.distanceMeters",
  "routes.legs.duration",
].join(",");

/**
 * POST /api/app/places/directions
 *
 * Server-side proxy for Google Routes API v2 (`routes:computeRoutes`).
 * Returns total distance/duration plus per-leg breakdowns and an encoded
 * polyline the client can decode for an accurate on-road overlay.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(req);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", code: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Routes API not configured", code: "NO_API_KEY" },
      { status: 500 }
    );
  }

  const { origin, destination, waypoints, mode = "WALK" } = parsed.data;

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: {
      location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
    },
    ...(waypoints && waypoints.length > 0
      ? {
          intermediates: waypoints.map((w) => ({
            location: { latLng: { latitude: w.lat, longitude: w.lng } },
          })),
        }
      : {}),
    travelMode: mode,
    // Routing preference is only supported for DRIVE/BICYCLE; omitting it
    // lets the API pick the safe default for the chosen mode.
    languageCode: "zh-TW",
    units: "METRIC",
  };

  try {
    const res = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      console.error("[routes] upstream error", res.status, await res.text());
      return NextResponse.json(
        { error: "Upstream Routes error", code: "UPSTREAM_ERROR" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { routes?: RoutesApiRoute[] };
    const route = data.routes?.[0];
    if (!route) {
      return NextResponse.json(
        { error: "No route found", code: "NO_ROUTE" },
        { status: 404 }
      );
    }

    const legs: DirectionsLeg[] = (route.legs ?? []).map((l) => ({
      distanceMeters: Number(l.distanceMeters ?? 0),
      durationSeconds: parseDuration(l.duration),
    }));

    return NextResponse.json<DirectionsResponse>({
      legs,
      totalDistanceMeters: Number(route.distanceMeters ?? 0),
      totalDurationSeconds: parseDuration(route.duration),
      polyline: route.polyline?.encodedPolyline ?? null,
      mode,
    });
  } catch (err) {
    console.error("[routes] threw", err);
    return NextResponse.json(
      { error: "Network error", code: "NETWORK_ERROR" },
      { status: 502 }
    );
  }
}

// Routes API returns durations as protobuf-style strings like "1234s".
function parseDuration(d: string | undefined): number {
  if (!d) return 0;
  const m = d.match(/^([\d.]+)s$/);
  if (!m) return 0;
  return Math.round(Number(m[1]));
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/app-server";

export interface MatrixCell {
  originIndex: number;
  destinationIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  status: "OK" | "ERROR";
}

export interface DistanceMatrixResponse {
  cells: MatrixCell[];
  mode: "WALK" | "DRIVE" | "BICYCLE" | "TRANSIT";
}

const LatLngSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

const BodySchema = z.object({
  origins: z.array(LatLngSchema).min(1).max(25),
  destinations: z.array(LatLngSchema).min(1).max(25),
  mode: z.enum(["WALK", "DRIVE", "BICYCLE", "TRANSIT"]).optional(),
});

const FIELD_MASK = [
  "originIndex",
  "destinationIndex",
  "distanceMeters",
  "duration",
  "condition",
].join(",");

interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  distanceMeters?: number;
  duration?: string;
  condition?: string;
}

/**
 * POST /api/app/places/distance-matrix
 *
 * Server-side proxy for Google Routes API `routes:computeRouteMatrix`. Used
 * by the Day Plan rail to show hop-to-hop travel times. Routes API caps the
 * product `origins * destinations` at 625; we cap inputs at 25 each so a
 * single matrix call is safe.
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

  const { origins, destinations, mode = "WALK" } = parsed.data;

  const body = {
    origins: origins.map((o) => ({
      waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
    })),
    destinations: destinations.map((d) => ({
      waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
    })),
    travelMode: mode,
    languageCode: "zh-TW",
    units: "METRIC",
  };

  try {
    const res = await fetch(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
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
      console.error("[matrix] upstream error", res.status, await res.text());
      return NextResponse.json(
        { error: "Upstream Routes error", code: "UPSTREAM_ERROR" },
        { status: 502 }
      );
    }

    const raw = (await res.json()) as RouteMatrixElement[];
    const cells: MatrixCell[] = raw.map((el) => ({
      originIndex: Number(el.originIndex ?? 0),
      destinationIndex: Number(el.destinationIndex ?? 0),
      distanceMeters:
        el.distanceMeters != null ? Number(el.distanceMeters) : null,
      durationSeconds: parseDuration(el.duration),
      status: el.condition === "ROUTE_EXISTS" ? "OK" : "ERROR",
    }));

    return NextResponse.json<DistanceMatrixResponse>({ cells, mode });
  } catch (err) {
    console.error("[matrix] threw", err);
    return NextResponse.json(
      { error: "Network error", code: "NETWORK_ERROR" },
      { status: 502 }
    );
  }
}

function parseDuration(d: string | undefined): number | null {
  if (!d) return null;
  const m = d.match(/^([\d.]+)s$/);
  if (!m) return null;
  return Math.round(Number(m[1]));
}

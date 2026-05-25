"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Marker,
  InfoWindow,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle: string | null;
  itemType: string;
  stage: "confirmed" | "pending" | "todo" | "shared";
  kind: "item" | "option" | "memory";
  itemId: string | null;
  optionId: string | null;
  dayKey: string | null;
  votedByMe?: boolean;
  bookingUrl?: string | null;
}

export interface DayRoute {
  dayKey: string;
  label: string;
  points: Array<{ lat: number; lng: number; title: string }>;
  color: string;
}

export interface MapCanvasProps {
  destination: { name: string | null; lat: number | null; lng: number | null };
  pins: MapPin[];
  dayRoutes: DayRoute[];
  selectedPinId: string | null;
  onPinSelect: (pin: MapPin) => void;
  /**
   * Optional Google-encoded polyline (from Routes API) rendered as a solid
   * overlay on top of the dashed daily routes. Used by the Main Map page to
   * show the actual on-road route for a selected day or pair of pins.
   */
  encodedPolyline?: string | null;
  /** Map type / basemap toggle. Defaults to "roadmap". */
  mapTypeId?: "roadmap" | "satellite" | "hybrid" | "terrain";
}

// ─── Type → color/icon ────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  hotel: "#3b82f6",
  restaurant: "#f97316",
  activity: "#10b981",
  transport: "#64748b",
  flight: "#0ea5e9",
  insurance: "#8b5cf6",
  other: "#6b7280",
};

const TYPE_GLYPH: Record<string, string> = {
  hotel: "🏨",
  restaurant: "🍽",
  activity: "🎯",
  transport: "🚌",
  flight: "✈",
  insurance: "🛡",
  other: "📌",
};

// ─── Marker ───────────────────────────────────────────────────────────────────

function PinMarker({
  pin,
  selected,
  onClick,
  useAdvancedMarker,
}: {
  pin: MapPin;
  selected: boolean;
  onClick: () => void;
  useAdvancedMarker: boolean;
}) {
  const color = TYPE_COLOR[pin.itemType] ?? TYPE_COLOR.other;
  const glyph = TYPE_GLYPH[pin.itemType] ?? TYPE_GLYPH.other;
  const dimmed =
    pin.stage === "pending" || pin.stage === "todo" || pin.stage === "shared";
  const size = selected ? 36 : pin.kind === "memory" ? 26 : 30;
  const ringWidth = selected ? 4 : 2;
  const border =
    pin.stage === "pending"
      ? "2px dashed white"
      : pin.kind === "memory"
        ? "2px dotted white"
        : undefined;

  if (!useAdvancedMarker) {
    return (
      <Marker
        position={{ lat: pin.lat, lng: pin.lng }}
        onClick={onClick}
        zIndex={selected ? 1000 : pin.kind === "memory" ? 1 : 2}
        title={pin.title}
        label={{
          text: glyph,
          color: "white",
          fontSize: selected ? "16px" : "14px",
        }}
      />
    );
  }

  return (
    <AdvancedMarker
      position={{ lat: pin.lat, lng: pin.lng }}
      onClick={onClick}
      zIndex={selected ? 1000 : pin.kind === "memory" ? 1 : 2}
    >
      <div
        style={{
          width: size,
          height: size,
          background: color,
          color: "white",
          borderRadius: "9999px 9999px 9999px 0",
          transform: "rotate(-45deg)",
          boxShadow: `0 0 0 ${ringWidth}px ${selected ? color : "white"}, 0 2px 4px rgba(0,0,0,0.2)`,
          opacity: dimmed ? 0.85 : 1,
          border,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            transform: "rotate(45deg)",
            fontSize: size * 0.45,
            lineHeight: 1,
          }}
        >
          {glyph}
        </span>
      </div>
    </AdvancedMarker>
  );
}

// ─── Daily route polylines (imperative) ───────────────────────────────────────

function DayRoutes({ routes }: { routes: DayRoute[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map || !mapsLib) return;

    for (const p of polylinesRef.current) p.setMap(null);
    polylinesRef.current = [];

    for (const route of routes) {
      if (route.points.length < 2) continue;
      // Dashed polyline via a repeating icon — Google Maps doesn't support
      // dashArray directly the way SVG/Leaflet do.
      const poly = new mapsLib.Polyline({
        map,
        path: route.points.map((p) => ({ lat: p.lat, lng: p.lng })),
        strokeOpacity: 0,
        icons: [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 0.55,
              strokeColor: route.color,
              strokeWeight: 3,
              scale: 3,
            },
            offset: "0",
            repeat: "12px",
          },
        ],
      });
      polylinesRef.current.push(poly);
    }

    return () => {
      for (const p of polylinesRef.current) p.setMap(null);
      polylinesRef.current = [];
    };
  }, [map, mapsLib, routes]);

  return null;
}

// ─── Encoded polyline overlay (Routes API result) ─────────────────────────────

function EncodedPolylineOverlay({ encoded }: { encoded: string | null | undefined }) {
  const map = useMap();
  const geometryLib = useMapsLibrary("geometry");
  const mapsLib = useMapsLibrary("maps");
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  useEffect(() => {
    if (!map || !mapsLib || !geometryLib || !encoded) {
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      return;
    }
    const path = geometryLib.encoding.decodePath(encoded);
    const poly = new mapsLib.Polyline({
      map,
      path,
      strokeColor: "#2563eb",
      strokeOpacity: 0.85,
      strokeWeight: 5,
    });
    polylineRef.current?.setMap(null);
    polylineRef.current = poly;
    return () => {
      poly.setMap(null);
      if (polylineRef.current === poly) polylineRef.current = null;
    };
  }, [map, mapsLib, geometryLib, encoded]);

  return null;
}

// ─── Auto-fit on change ───────────────────────────────────────────────────────

function FitBounds({
  pins,
  destination,
  selectedPinId,
}: {
  pins: MapPin[];
  destination: MapCanvasProps["destination"];
  selectedPinId: string | null;
}) {
  const map = useMap();
  const coreLib = useMapsLibrary("core");
  const lastFitKey = useRef<string>("");

  useEffect(() => {
    if (!map || !coreLib) return;

    if (selectedPinId) {
      const pin = pins.find((p) => p.id === selectedPinId);
      if (pin) {
        map.panTo({ lat: pin.lat, lng: pin.lng });
        const zoom = map.getZoom() ?? 11;
        if (zoom < 14) map.setZoom(14);
      }
      return;
    }

    const points: Array<{ lat: number; lng: number }> = [];
    for (const p of pins) points.push({ lat: p.lat, lng: p.lng });
    if (destination.lat != null && destination.lng != null) {
      points.push({ lat: destination.lat, lng: destination.lng });
    }
    if (points.length === 0) return;

    const fitKey = points.map((p) => `${p.lat},${p.lng}`).join("|");
    if (fitKey === lastFitKey.current) return;
    lastFitKey.current = fitKey;

    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(13);
    } else {
      const bounds = new coreLib.LatLngBounds();
      for (const p of points) bounds.extend(p);
      map.fitBounds(bounds, 40);
    }
  }, [map, coreLib, pins, destination.lat, destination.lng, selectedPinId]);

  return null;
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function TripMapCanvas(props: MapCanvasProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

  if (!apiKey) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--surface-sunken)]/40 p-6 text-center">
        <p className="text-xs text-[var(--text-muted)]">
          地圖未設定 — 請在環境變數加入{" "}
          <code className="text-mono">
            NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY
          </code>
          。
        </p>
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <CanvasInner {...props} mapId={mapId} />
    </APIProvider>
  );
}

function CanvasInner({
  destination,
  pins,
  dayRoutes,
  selectedPinId,
  onPinSelect,
  encodedPolyline,
  mapTypeId,
  mapId,
}: MapCanvasProps & { mapId: string | undefined }) {
  const hasExplicitCenter = destination.lat != null && destination.lng != null;
  const center = useMemo<{ lat: number; lng: number }>(() => {
    if (hasExplicitCenter) return { lat: destination.lat!, lng: destination.lng! };
    if (pins.length > 0) return { lat: pins[0].lat, lng: pins[0].lng };
    // v1 ski-region midpoint (Honshu/Hokkaido ski belt). Centres the global
    // map over the six covered regions (Niseko in the north down to Naeba /
    // Shiga Kogen / Hakuba in central Honshu) instead of an arbitrary city.
    return { lat: 38.5, lng: 138.5 };
  }, [hasExplicitCenter, destination.lat, destination.lng, pins]);
  // Country-level zoom when there's nothing to anchor on, so all six v1
  // regions stay visible.
  const defaultZoom = hasExplicitCenter || pins.length > 0 ? 11 : 5;

  const selectedPin = useMemo(
    () => pins.find((p) => p.id === selectedPinId) ?? null,
    [pins, selectedPinId]
  );

  // InfoWindow can be dismissed via its × without clearing parent selection.
  // Tracking the dismissed id lets a fresh selection re-open the window
  // without an effect that resets local state.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const showInfo = selectedPin != null && dismissedId !== selectedPin.id;
  const useAdvancedMarkers = Boolean(mapId?.trim());

  return (
    <Map
      defaultCenter={center}
      defaultZoom={defaultZoom}
      gestureHandling="greedy"
      mapId={mapId}
      mapTypeId={mapTypeId ?? "roadmap"}
      className="h-full w-full"
      style={{ minHeight: "100%" }}
    >
      <FitBounds
        pins={pins}
        destination={destination}
        selectedPinId={selectedPinId}
      />
      <DayRoutes routes={dayRoutes} />
      <EncodedPolylineOverlay encoded={encodedPolyline} />

      {destination.lat != null && destination.lng != null && (
        useAdvancedMarkers ? (
          <AdvancedMarker
            position={{ lat: destination.lat, lng: destination.lng }}
            zIndex={0}
            title={destination.name ?? "Trip destination"}
          >
            <div
              style={{
                width: 12,
                height: 12,
                background: "#111827",
                border: "2px solid white",
                borderRadius: "9999px",
                boxShadow:
                  "0 0 0 2px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.2)",
              }}
            />
          </AdvancedMarker>
        ) : (
          <Marker
            position={{ lat: destination.lat, lng: destination.lng }}
            zIndex={0}
            title={destination.name ?? "Trip destination"}
          />
        )
      )}

      {pins.map((pin) => (
        <PinMarker
          key={pin.id}
          pin={pin}
          selected={selectedPinId === pin.id}
          onClick={() => onPinSelect(pin)}
          useAdvancedMarker={useAdvancedMarkers}
        />
      ))}

      {showInfo && selectedPin && (
        <InfoWindow
          position={{ lat: selectedPin.lat, lng: selectedPin.lng }}
          pixelOffset={[0, -36]}
          onCloseClick={() => setDismissedId(selectedPin.id)}
          headerDisabled
        >
          <div style={{ minWidth: 180, fontFamily: "system-ui" }}>
            <strong>{selectedPin.title}</strong>
            {selectedPin.subtitle && (
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                {selectedPin.subtitle}
              </div>
            )}
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                textTransform: "uppercase",
                color: "#6b7280",
              }}
            >
              {selectedPin.itemType} · {selectedPin.stage}
            </div>
            {selectedPin.bookingUrl && (
              <a
                href={selectedPin.bookingUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-block",
                  marginTop: 6,
                  fontSize: 12,
                  color: "#2563eb",
                }}
              >
                開啟連結 ↗
              </a>
            )}
          </div>
        </InfoWindow>
      )}
    </Map>
  );
}

"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle: string | null;
  itemType: string;
  stage: "confirmed" | "pending" | "todo";
  kind: "item" | "option";
  itemId: string;
  optionId: string | null;
  dayKey: string | null;
  votedByMe?: boolean;
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

function pinIcon(pin: MapPin, selected: boolean): L.DivIcon {
  const color = TYPE_COLOR[pin.itemType] ?? TYPE_COLOR.other;
  const glyph = TYPE_GLYPH[pin.itemType] ?? TYPE_GLYPH.other;
  const dimmed = pin.stage === "pending" || pin.stage === "todo";
  const ring = selected ? "4px" : "2px";
  const size = selected ? 36 : 30;
  const opacity = dimmed ? 0.85 : 1;
  const dash = pin.stage === "pending" ? "border: 2px dashed white;" : "";
  const html = `
    <div style="
      width: ${size}px; height: ${size}px;
      background: ${color};
      color: white;
      border-radius: 9999px 9999px 9999px 0;
      transform: rotate(-45deg);
      box-shadow: 0 0 0 ${ring} ${selected ? color : "white"}, 0 2px 4px rgba(0,0,0,0.2);
      opacity: ${opacity};
      ${dash}
      display: flex; align-items: center; justify-content: center;
    ">
      <span style="transform: rotate(45deg); font-size: ${size * 0.45}px; line-height: 1;">${glyph}</span>
    </div>
  `;
  return L.divIcon({
    html,
    className: "trip-map-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
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
  const lastFitKey = useRef<string>("");

  useEffect(() => {
    if (selectedPinId) {
      const pin = pins.find((p) => p.id === selectedPinId);
      if (pin) {
        map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 14), {
          duration: 0.45,
        });
      }
      return;
    }

    const points: Array<[number, number]> = [];
    for (const p of pins) points.push([p.lat, p.lng]);
    if (destination.lat != null && destination.lng != null) {
      points.push([destination.lat, destination.lng]);
    }
    if (points.length === 0) return;

    const fitKey = points.map((p) => p.join(",")).join("|");
    if (fitKey === lastFitKey.current) return;
    lastFitKey.current = fitKey;

    if (points.length === 1) {
      map.setView(points[0], 13);
    } else {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [pins, destination.lat, destination.lng, selectedPinId, map]);

  return null;
}

// ─── Main canvas ──────────────────────────────────────────────────────────────

export default function TripMapCanvas({
  destination,
  pins,
  dayRoutes,
  selectedPinId,
  onPinSelect,
}: MapCanvasProps) {
  const center = useMemo<[number, number]>(() => {
    if (destination.lat != null && destination.lng != null)
      return [destination.lat, destination.lng];
    if (pins.length > 0) return [pins[0].lat, pins[0].lng];
    return [35.0116, 135.7681]; // Kyoto fallback so the tile layer never shows blank
  }, [destination.lat, destination.lng, pins]);

  return (
    <MapContainer
      center={center}
      zoom={11}
      scrollWheelZoom
      className="h-full w-full"
      style={{ minHeight: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds
        pins={pins}
        destination={destination}
        selectedPinId={selectedPinId}
      />

      {destination.lat != null && destination.lng != null && (
        <CircleMarker
          center={[destination.lat, destination.lng]}
          radius={6}
          pathOptions={{
            color: "#111827",
            fillColor: "#111827",
            fillOpacity: 0.85,
            weight: 2,
          }}
        >
          <Popup>
            <strong>{destination.name ?? "Trip destination"}</strong>
            <br />
            <span style={{ color: "#6b7280", fontSize: 12 }}>Trip center</span>
          </Popup>
        </CircleMarker>
      )}

      {dayRoutes.map((route) =>
        route.points.length >= 2 ? (
          <Polyline
            key={route.dayKey}
            positions={route.points.map((p) => [p.lat, p.lng])}
            pathOptions={{
              color: route.color,
              weight: 3,
              opacity: 0.55,
              dashArray: "6 6",
            }}
          />
        ) : null
      )}

      {pins.map((pin) => (
        <Marker
          key={pin.id}
          position={[pin.lat, pin.lng]}
          icon={pinIcon(pin, selectedPinId === pin.id)}
          eventHandlers={{
            click: () => onPinSelect(pin),
          }}
        >
          <Popup>
            <div style={{ minWidth: 180 }}>
              <strong>{pin.title}</strong>
              {pin.subtitle && (
                <div style={{ color: "#6b7280", fontSize: 12 }}>
                  {pin.subtitle}
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
                {pin.itemType} · {pin.stage}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

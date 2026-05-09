"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appFetchJson } from "@/lib/app-client";
import {
  TabPageHeader,
  TabSurface,
  TabSurfaceTitle,
  TabError,
  TabSkeleton,
} from "@/components/app/tab-shell";
import type { Trip, TripStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: TripStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function TripSettingsClient({ tripId }: { tripId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [role, setRole] = useState<"organizer" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<TripStatus>("draft");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await appFetchJson<{ trip: Trip; role: "organizer" | "member" }>(
        `/api/app/trips/${tripId}`
      );
      setTrip(res.trip);
      setRole(res.role);
      setTitle(res.trip.title ?? "");
      setDestination(res.trip.destination_name ?? "");
      setStartDate(res.trip.start_date ?? "");
      setEndDate(res.trip.end_date ?? "");
      setStatus(res.trip.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trip");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!trip) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const payload: Record<string, unknown> = {};
      const trimmedTitle = title.trim();
      const trimmedDestination = destination.trim();
      if (trimmedTitle !== (trip.title ?? "")) {
        payload.title = trimmedTitle === "" ? null : trimmedTitle;
      }
      if (trimmedDestination !== (trip.destination_name ?? "")) {
        payload.destinationName = trimmedDestination === "" ? null : trimmedDestination;
      }
      if ((startDate || null) !== trip.start_date) {
        payload.startDate = startDate || null;
      }
      if ((endDate || null) !== trip.end_date) {
        payload.endDate = endDate || null;
      }
      if (status !== trip.status) {
        payload.status = status;
      }
      if (Object.keys(payload).length === 0) {
        setSaving(false);
        return;
      }
      const res = await appFetchJson<{ trip: Trip }>(`/api/app/trips/${tripId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setTrip(res.trip);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save trip");
    } finally {
      setSaving(false);
    }
  }

  if (error && !trip) {
    return <TabError message={error} onRetry={() => void load()} />;
  }

  if (!trip) {
    return <TabSkeleton />;
  }

  const isOrganizer = role === "organizer";

  return (
    <div className="space-y-6">
      <TabPageHeader
        title="Trip settings"
        subtitle={
          isOrganizer
            ? "Edit the trip basics below. Destination lookup (map, timezone) updates automatically when the bot resolves it from chat."
            : "Only organizers can edit trip basics. Ask your organizer to make changes, or promote yourself via the LINE bot."
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isOrganizer) void handleSave();
        }}
        className="surface-tile space-y-5 p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="trip-destination">Destination</Label>
            <Input
              id="trip-destination"
              placeholder="Osaka, Japan"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              disabled={!isOrganizer}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-title">Trip title (optional)</Label>
            <Input
              id="trip-title"
              placeholder="Summer gang trip 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!isOrganizer}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-start">Start date</Label>
            <Input
              id="trip-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!isOrganizer}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="trip-end">End date</Label>
            <Input
              id="trip-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!isOrganizer}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as TripStatus)}
              disabled={!isOrganizer}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <p className="text-xs text-[var(--status-blocked)]">{error}</p>
        )}
        {success && (
          <p className="text-xs font-medium text-[var(--accent-line)]">Saved.</p>
        )}

        {isOrganizer && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        )}
      </form>

      {isOrganizer && (
        <TabSurface className="flex items-center justify-between gap-4">
          <TabSurfaceTitle
            title="Publish as template"
            subtitle="Share this trip's itinerary so others can use it as a starting point."
          />
          <Link href={`/app/trips/${tripId}/publish`}>
            <Button variant="outline" size="sm">Publish</Button>
          </Link>
        </TabSurface>
      )}

      <TabSurface>
        <TabSurfaceTitle
          title="Resolved destination"
          subtitle="These fields are populated by the AI when it resolves the destination from chat. Update the destination above to trigger a re-sync."
        />
        <dl className="mt-3 space-y-2 text-xs">
          <DetailRow label="Formatted address" value={trip.destination_formatted_address} />
          <DetailRow label="Timezone" value={trip.destination_timezone} />
          <DetailRow
            label="Coordinates"
            value={
              trip.destination_lat != null && trip.destination_lng != null
                ? `${trip.destination_lat}, ${trip.destination_lng}`
                : null
            }
          />
          <DetailRow label="Google Place ID" value={trip.destination_place_id} mono />
          <DetailRow
            label="Maps URL"
            value={
              trip.destination_google_maps_url ? (
                <a
                  href={trip.destination_google_maps_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent-line)] underline underline-offset-2"
                >
                  Open
                </a>
              ) : null
            }
          />
          <DetailRow
            label="Last synced"
            value={
              trip.destination_source_last_synced_at
                ? new Date(trip.destination_source_last_synced_at).toLocaleString()
                : null
            }
          />
        </dl>
      </TabSurface>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <dt className="text-caps">{label}</dt>
      <dd
        className={`max-w-[70%] text-right text-[var(--text-primary)] ${mono ? "text-mono text-[11px]" : ""}`}
      >
        {value ?? <span className="text-[var(--text-muted)] italic">—</span>}
      </dd>
    </div>
  );
}

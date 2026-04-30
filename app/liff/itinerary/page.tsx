"use client";

import { useEffect, useState } from "react";
import {
  LoadingSpinner,
  TimelineSkeleton,
  ErrorScreen,
  EmptyState,
} from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import type { ItineraryItem } from "@/app/api/liff/itinerary/route";
import type { ItemType, BookingStatus } from "@/lib/types";
import type { TripItemMetadata } from "@/lib/trip-item-metadata";

type Trip = {
  id: string;
  destination_name: string | null;
  start_date: string | null;
  end_date: string | null;
};

const ITEM_TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "Food",
  activity: "Plan",
  transport: "Ride",
  flight: "Flight",
  insurance: "Cover",
  other: "Item",
};

const ADDABLE_TYPES: ItemType[] = [
  "hotel",
  "restaurant",
  "activity",
  "transport",
  "flight",
  "insurance",
  "other",
];

export default function ItineraryPage() {
  const {
    isReady,
    isLoggedIn,
    error,
    session,
    sessionLoading,
    sessionError,
    reloadSession,
  } = useLiffSession();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bookingItem, setBookingItem] = useState<ItineraryItem | null>(null);

  async function loadItinerary(tripId: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await liffFetch(`/api/liff/itinerary?tripId=${tripId}`);
      if (!res.ok) throw new Error("Failed to load itinerary");
      const data = await res.json();
      setTrip(data.trip);
      setItems(data.items);
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "itinerary",
          err,
          "We could not load the itinerary. Reopen this page in LINE and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  async function reload() {
    const sessionData = await reloadSession();
    if (!sessionData?.activeTrip) {
      setTrip(null);
      setItems([]);
      return;
    }
    await loadItinerary(sessionData.activeTrip.id);
  }

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;
    const activeTrip = session.activeTrip;
    if (!activeTrip) {
      setTrip(null);
      setItems([]);
      return;
    }
    void loadItinerary(activeTrip.id);
  }, [isReady, isLoggedIn, session, sessionLoading]);

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <TimelineSkeleton />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={reload} />;
  if (loading) return <TimelineSkeleton />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={reload} />;

  if (!trip) {
    return (
      <EmptyState
        emoji="Map"
        title="No active trip"
        description={
          <>
            Type <code className="font-mono bg-[var(--secondary)] px-1 py-0.5 rounded text-xs">/start</code>{" "}
            in the group chat to begin.
          </>
        }
      />
    );
  }

  const grouped = groupByDate(items);

  return (
    <div className="max-w-md mx-auto pb-24">
      <TripHeader
        trip={trip}
        destinationTimezone={session?.activeTrip?.destination_timezone ?? null}
        destinationMapUrl={session?.activeTrip?.destination_google_maps_url ?? null}
        destinationAddress={session?.activeTrip?.destination_formatted_address ?? null}
        destinationLastSyncedAt={session?.activeTrip?.destination_source_last_synced_at ?? null}
      />

      {items.length === 0 ? (
        <EmptyState
          emoji="Soon"
          title="No confirmed items yet"
          description={
            <>
              Use <code className="font-mono text-xs">/vote</code> in chat to decide,
              or tap the <strong>+</strong> button to add an item directly.
            </>
          }
        />
      ) : (
        <>
          <div className="px-4 pb-3 flex gap-4 text-xs text-[var(--muted-foreground)]">
            <span className="text-[var(--primary)] font-semibold">{items.length} confirmed</span>
            {grouped.length > 1 && <span>{grouped.length} days</span>}
            {countNeedsBooking(items) > 0 && (
              <span className="text-amber-600 font-medium">
                {countNeedsBooking(items)} need booking
              </span>
            )}
          </div>

          <div className="px-4 pb-4 space-y-6">
            {grouped.map(({ date, label, dayItems }) => (
              <div key={date}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide whitespace-nowrap">
                    {label}
                  </span>
                  <div className="h-px flex-1 bg-[var(--border)]" />
                </div>

                <div className="space-y-3">
                  {dayItems.map((item) => (
                    <ItineraryCard
                      key={item.id}
                      item={item}
                      onMarkBooked={() => setBookingItem(item)}
                      onDeleted={reload}
                      tripId={trip.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <button
        onClick={() => setAddOpen(true)}
        className="fixed bottom-20 right-4 z-20 h-14 w-14 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-2xl font-light shadow-lg active:scale-95 transition-transform"
        aria-label="Add item"
      >
        +
      </button>

      <AddItemSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        tripId={trip.id}
        onCreated={reload}
      />

      <BookingSheet
        item={bookingItem}
        tripId={trip.id}
        onOpenChange={(open) => !open && setBookingItem(null)}
        onUpdated={reload}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countNeedsBooking(items: ItineraryItem[]): number {
  return items.filter((i) => i.booking_status === "needed").length;
}

function groupByDate(items: ItineraryItem[]) {
  const map = new Map<string, { label: string; dayItems: ItineraryItem[] }>();
  for (const item of items) {
    let key = "no-date";
    let label = "No date set";
    if (item.deadline_at) {
      const d = new Date(item.deadline_at);
      key = d.toISOString().split("T")[0];
      label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        weekday: "short",
      });
    }
    if (!map.has(key)) map.set(key, { label, dayItems: [] });
    map.get(key)!.dayItems.push(item);
  }
  return Array.from(map.entries()).map(([date, value]) => ({ date, ...value }));
}

// ─── Trip header (unchanged from previous version) ────────────────────────────

function TripHeader({
  trip,
  destinationTimezone,
  destinationMapUrl,
  destinationAddress,
  destinationLastSyncedAt,
}: {
  trip: Trip;
  destinationTimezone: string | null;
  destinationMapUrl: string | null;
  destinationAddress: string | null;
  destinationLastSyncedAt: string | null;
}) {
  const timeZoneLabel = destinationTimezone?.split("/").join(" / ") ?? null;
  const lastSyncedLabel = formatLastSyncedLabel(destinationLastSyncedAt);

  return (
    <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3">
      <h1 className="font-bold text-base">{trip.destination_name ?? "New trip"}</h1>
      {trip.start_date && trip.end_date && (
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
          {trip.start_date} to {trip.end_date}
        </p>
      )}
      {(timeZoneLabel || destinationMapUrl || destinationAddress) && (
        <div className="mt-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {timeZoneLabel && (
              <Badge variant="secondary" className="rounded-full">
                Timezone: {timeZoneLabel}
              </Badge>
            )}
            {destinationMapUrl && (
              <a
                href={destinationMapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-xs font-medium hover:bg-[var(--secondary)]"
              >
                Open map
              </a>
            )}
            {!destinationMapUrl && destinationAddress && (
              <Badge variant="outline" className="max-w-full truncate">
                {destinationAddress}
              </Badge>
            )}
          </div>
          {lastSyncedLabel && (
            <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
              Synced {lastSyncedLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatLastSyncedLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Itinerary card ───────────────────────────────────────────────────────────

function ItineraryCard({
  item,
  onMarkBooked,
  onDeleted,
  tripId,
}: {
  item: ItineraryItem;
  onMarkBooked: () => void;
  onDeleted: () => void;
  tripId: string;
}) {
  const badge = ITEM_TYPE_LABEL[item.item_type] ?? "Item";
  const option = item.confirmed_option;
  const isManual = item.source === "manual";
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Remove this item from the itinerary?")) return;
    setDeleting(true);
    try {
      const res = await liffFetch(
        `/api/liff/itinerary?tripId=${tripId}&itemId=${item.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete");
      onDeleted();
    } catch {
      alert("Could not delete this item.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      {option?.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={option.image_url} alt={option.name} className="w-full h-36 object-cover" />
      )}

      <div className="p-4 space-y-2">
        <div className="flex items-start gap-2.5">
          <Badge variant="secondary" className="shrink-0">{badge}</Badge>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{item.title}</p>
            {option && option.name !== item.title && (
              <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{option.name}</p>
            )}
          </div>
          <BookingStatusBadge status={item.booking_status} />
        </div>

        {option?.address && (
          <p className="pl-8 text-xs text-[var(--muted-foreground)] leading-relaxed">
            {option.address}
          </p>
        )}

        <MetadataDetails metadata={item.metadata} />

        {item.booking_ref && (
          <p className="pl-8 text-xs text-[var(--muted-foreground)]">
            Confirmation: <span className="font-mono">{item.booking_ref}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pl-8 pt-1">
          {option?.price_level && (
            <span className="text-xs text-[var(--muted-foreground)]">{option.price_level}</span>
          )}
          {option?.google_maps_url && (
            <a
              href={option.google_maps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[var(--primary)] underline underline-offset-2"
            >
              Map
            </a>
          )}
          {option?.booking_url && (
            <a
              href={option.booking_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[var(--primary)] underline underline-offset-2"
            >
              Book
            </a>
          )}
          <TypeSpecificActions metadata={item.metadata} />
          {item.booking_status === "needed" && (
            <button
              onClick={onMarkBooked}
              className="text-xs font-medium text-emerald-700 underline underline-offset-2"
            >
              Mark booked
            </button>
          )}
          {isManual && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="ml-auto text-xs text-[var(--muted-foreground)] hover:text-red-600 disabled:opacity-50"
            >
              {deleting ? "Removing..." : "Remove"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BookingStatusBadge({ status }: { status: BookingStatus }) {
  if (status === "booked") {
    return (
      <Badge className="shrink-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        Booked
      </Badge>
    );
  }
  if (status === "needed") {
    return (
      <Badge className="shrink-0 bg-amber-100 text-amber-800 hover:bg-amber-100">
        Needs booking
      </Badge>
    );
  }
  return null;
}

// ─── Type-specific metadata rendering ────────────────────────────────────────

function MetadataDetails({ metadata }: { metadata: TripItemMetadata }) {
  const rows = buildMetadataRows(metadata);
  if (rows.length === 0) return null;
  return (
    <div className="pl-8 space-y-0.5">
      {rows.map(({ label, value }) => (
        <p key={label} className="text-xs text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">{label}:</span> {value}
        </p>
      ))}
    </div>
  );
}

function buildMetadataRows(metadata: TripItemMetadata): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  switch (metadata.type) {
    case "hotel":
      if (metadata.check_in_time) rows.push({ label: "Check-in", value: metadata.check_in_time });
      if (metadata.check_out_time) rows.push({ label: "Check-out", value: metadata.check_out_time });
      if (metadata.nights) rows.push({ label: "Nights", value: String(metadata.nights) });
      if (metadata.room_type) rows.push({ label: "Room", value: metadata.room_type });
      break;
    case "restaurant":
      if (metadata.reservation_time) rows.push({ label: "Reservation", value: metadata.reservation_time });
      if (metadata.party_size) rows.push({ label: "Party", value: `${metadata.party_size} people` });
      if (metadata.cuisine) rows.push({ label: "Cuisine", value: metadata.cuisine });
      break;
    case "transport":
      if (metadata.mode) rows.push({ label: "Mode", value: metadata.mode });
      if (metadata.pickup_time) rows.push({ label: "Pickup", value: metadata.pickup_time });
      if (metadata.pickup_location) rows.push({ label: "From", value: metadata.pickup_location });
      if (metadata.dropoff_location) rows.push({ label: "To", value: metadata.dropoff_location });
      if (metadata.provider) rows.push({ label: "Provider", value: metadata.provider });
      break;
    case "flight":
      if (metadata.flight_number) rows.push({ label: "Flight", value: metadata.flight_number });
      if (metadata.airline) rows.push({ label: "Airline", value: metadata.airline });
      if (metadata.departure_airport && metadata.arrival_airport) {
        rows.push({ label: "Route", value: `${metadata.departure_airport} → ${metadata.arrival_airport}` });
      }
      if (metadata.departure_time) rows.push({ label: "Departs", value: formatDateTime(metadata.departure_time) });
      if (metadata.terminal) rows.push({ label: "Terminal", value: metadata.terminal });
      if (metadata.gate) rows.push({ label: "Gate", value: metadata.gate });
      if (metadata.seat) rows.push({ label: "Seat", value: metadata.seat });
      break;
    case "activity":
      if (metadata.start_time) rows.push({ label: "Start", value: metadata.start_time });
      if (metadata.duration_minutes) rows.push({ label: "Duration", value: `${metadata.duration_minutes} min` });
      if (metadata.meeting_point) rows.push({ label: "Meet at", value: metadata.meeting_point });
      break;
    case "insurance":
      if (metadata.provider) rows.push({ label: "Provider", value: metadata.provider });
      if (metadata.policy_number) rows.push({ label: "Policy", value: metadata.policy_number });
      if (metadata.coverage_type) rows.push({ label: "Coverage", value: metadata.coverage_type });
      if (metadata.valid_from && metadata.valid_until) {
        rows.push({ label: "Valid", value: `${metadata.valid_from} to ${metadata.valid_until}` });
      }
      break;
    case "other":
      if (metadata.notes) rows.push({ label: "Notes", value: metadata.notes });
      break;
  }
  return rows;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function TypeSpecificActions({ metadata }: { metadata: TripItemMetadata }) {
  if (metadata.type === "restaurant" && metadata.phone) {
    return (
      <a
        href={`tel:${metadata.phone}`}
        className="text-xs font-medium text-[var(--primary)] underline underline-offset-2"
      >
        Call
      </a>
    );
  }
  if (metadata.type === "insurance" && metadata.emergency_contact) {
    return (
      <a
        href={`tel:${metadata.emergency_contact}`}
        className="text-xs font-medium text-[var(--primary)] underline underline-offset-2"
      >
        Emergency
      </a>
    );
  }
  return null;
}

// ─── Add item sheet ───────────────────────────────────────────────────────────

function AddItemSheet({
  open,
  onOpenChange,
  tripId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  onCreated: () => void;
}) {
  const [itemType, setItemType] = useState<ItemType>("activity");
  const [title, setTitle] = useState("");
  const [deadlineLocal, setDeadlineLocal] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setItemType("activity");
    setTitle("");
    setDeadlineLocal("");
    setNotes("");
    setError(null);
  }

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const metadata = buildMetadataFromForm(itemType, notes);
      const body: Record<string, unknown> = {
        tripId,
        item_type: itemType,
        title: title.trim(),
        metadata,
      };
      if (deadlineLocal) {
        body.deadline_at = new Date(deadlineLocal).toISOString();
      }
      const res = await liffFetch("/api/liff/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to add item");
      }
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Add to itinerary</SheetTitle>
          <SheetDescription>
            Create a new item directly. For group decisions, use <code>/vote</code> in chat.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="add-type">Type</Label>
            <Select value={itemType} onValueChange={(v) => setItemType(v as ItemType)}>
              <SelectTrigger id="add-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADDABLE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ITEM_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-title">Title</Label>
            <Input
              id="add-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={titlePlaceholder(itemType)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-deadline">Date and time (optional)</Label>
            <Input
              id="add-deadline"
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-notes">Notes (optional)</Label>
            <Textarea
              id="add-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={notesPlaceholder(itemType)}
              rows={3}
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
            {submitting ? "Adding..." : "Add"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function titlePlaceholder(type: ItemType): string {
  switch (type) {
    case "hotel": return "e.g. Park Hyatt Tokyo";
    case "restaurant": return "e.g. Sushi Saito";
    case "activity": return "e.g. teamLab Borderless";
    case "transport": return "e.g. Airport pickup";
    case "flight": return "e.g. JL5";
    case "insurance": return "e.g. Allianz Travel Plus";
    default: return "What is it?";
  }
}

function notesPlaceholder(type: ItemType): string {
  switch (type) {
    case "hotel": return "Check-in time, room type, confirmation number";
    case "restaurant": return "Reservation time, party size, phone";
    case "flight": return "Flight number, terminal, seat";
    case "transport": return "Pickup point, provider, confirmation";
    default: return "Any extra details";
  }
}

function buildMetadataFromForm(type: ItemType, notes: string): TripItemMetadata {
  // v1: free-form notes go into the most useful field per type. Type-specific
  // forms come next iteration; this keeps the add path one screen.
  switch (type) {
    case "hotel":
      return { type: "hotel", room_type: notes || undefined };
    case "restaurant":
      return { type: "restaurant", cuisine: notes || undefined };
    case "transport":
      return { type: "transport", provider: notes || undefined };
    case "flight":
      return { type: "flight", flight_number: notes || undefined };
    case "activity":
      return { type: "activity", meeting_point: notes || undefined };
    case "insurance":
      return { type: "insurance", provider: notes || undefined };
    default:
      return { type: "other", notes: notes || undefined };
  }
}

// ─── Mark-as-booked sheet ─────────────────────────────────────────────────────

function BookingSheet({
  item,
  tripId,
  onOpenChange,
  onUpdated,
}: {
  item: ItineraryItem | null;
  tripId: string;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const [ref, setRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setRef(item.booking_ref ?? "");
      setError(null);
    }
  }, [item]);

  async function handleSubmit() {
    if (!item) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await liffFetch("/api/liff/itinerary", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          itemId: item.id,
          action: "booking",
          booking_status: "booked",
          booking_ref: ref.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Failed to update");
      }
      onOpenChange(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Mark as booked</SheetTitle>
          <SheetDescription>
            {item?.title}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="booking-ref">Confirmation number (optional)</Label>
            <Input
              id="booking-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. ABC123XYZ"
              maxLength={200}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="flex-1">
            {submitting ? "Saving..." : "Mark booked"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

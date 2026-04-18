"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LoadingSpinner,
  ListSkeleton,
  ErrorScreen,
  EmptyState,
  InlineError,
} from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import type { TripTicket, TicketType } from "@/lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const TICKET_TYPES: { value: TicketType; label: string; icon: string }[] = [
  { value: "flight", label: "Flight", icon: "Flight" },
  { value: "train", label: "Train", icon: "Train" },
  { value: "bus", label: "Bus", icon: "Bus" },
  { value: "ferry", label: "Ferry", icon: "Ferry" },
  { value: "museum", label: "Museum", icon: "Museum" },
  { value: "attraction", label: "Attraction", icon: "Spot" },
  { value: "event", label: "Event", icon: "Event" },
  { value: "accommodation", label: "Accommodation", icon: "Stay" },
  { value: "other", label: "Other", icon: "Ticket" },
];

const TYPE_MAP = Object.fromEntries(TICKET_TYPES.map((t) => [t.value, t])) as Record<
  TicketType,
  (typeof TICKET_TYPES)[number]
>;

// Group order for display
const TYPE_ORDER: TicketType[] = [
  "flight",
  "train",
  "bus",
  "ferry",
  "accommodation",
  "museum",
  "attraction",
  "event",
  "other",
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TicketsPage() {
  const { isReady, isLoggedIn, error, session, sessionLoading, sessionError, reloadSession } =
    useLiffSession();

  const [tickets, setTickets] = useState<TripTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add sheet state
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Detail sheet state
  const [selected, setSelected] = useState<TripTicket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const sessionData = await reloadSession();
      if (!sessionData?.activeTrip) {
        setTickets([]);
        return;
      }

      const res = await liffFetch(`/api/liff/tickets?tripId=${sessionData.activeTrip.id}`);
      if (!res.ok) throw new Error("Failed to load tickets");
      setTickets(await res.json());
    } catch (err) {
      setLoadError(
        toLiffErrorMessage("tickets", err, "We could not load tickets. Reopen this page in LINE.")
      );
    } finally {
      setLoading(false);
    }
  }, [reloadSession]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;

    if (!session.activeTrip) {
      setTickets([]);
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await liffFetch(`/api/liff/tickets?tripId=${session.activeTrip!.id}`);
        if (!res.ok) throw new Error("Failed to load tickets");
        setTickets(await res.json());
      } catch (err) {
        setLoadError(
          toLiffErrorMessage("tickets", err, "We could not load tickets. Reopen this page in LINE.")
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  async function handleAdd() {
    if (!form.title.trim() || !session?.activeTrip) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await liffFetch("/api/liff/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          tripId: session.activeTrip.id,
          ticketType: form.ticketType,
          title: form.title.trim(),
          vendor: form.vendor.trim() || undefined,
          referenceCode: form.referenceCode.trim() || undefined,
          passengerName: form.passengerName.trim() || undefined,
          validFrom: form.validFrom || undefined,
          validUntil: form.validUntil || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });

      if (!res.ok) throw new Error("Failed to add ticket");

      setForm(emptyForm());
      setAddOpen(false);
      await load();
    } catch (err) {
      setSubmitError(
        toLiffErrorMessage("add-ticket", err, "We could not add that ticket. Please try again.")
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(ticketId: string) {
    setDeleting(true);
    setActionError(null);

    try {
      const res = await liffFetch("/api/liff/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ticketId }),
      });

      if (!res.ok && res.status !== 204) throw new Error("Failed to delete ticket");

      setDeleteDialogOpen(false);
      setDetailOpen(false);
      setSelected(null);
      await load();
    } catch (err) {
      setActionError(
        toLiffErrorMessage("delete-ticket", err, "We could not delete that ticket.")
      );
      setDeleteDialogOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  // ─── Loading / auth guards ─────────────────────────────────────────────────

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <ListSkeleton />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={load} />;
  if (loading) return <ListSkeleton />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={load} />;

  if (!session?.activeTrip) {
    return (
      <EmptyState
        emoji="Ticket"
        title="No active trip"
        description={
          <>
            Type{" "}
            <code className="font-mono bg-[var(--secondary)] px-1 py-0.5 rounded text-xs">
              /start [destination] [dates]
            </code>{" "}
            in the group chat to begin planning.
          </>
        }
      />
    );
  }

  const canDelete = (ticket: TripTicket) =>
    session.member.role === "organizer" ||
    ticket.added_by_line_user_id === session.member.lineUserId;

  // Group by type in TYPE_ORDER
  const grouped = TYPE_ORDER.flatMap((type) => {
    const items = tickets.filter((t: TripTicket) => t.ticket_type === type);
    return items.length > 0 ? [{ type, items }] : [];
  });

  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-base">Tickets</h1>
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              {session.activeTrip.destination_name}
              {tickets.length > 0 && ` · ${tickets.length} ticket${tickets.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setForm(emptyForm());
              setSubmitError(null);
              setAddOpen(true);
            }}
            className="shrink-0 ml-3"
          >
            + Add
          </Button>
        </div>
      </div>

      {actionError && (
        <InlineError message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {tickets.length === 0 ? (
        <div className="px-4 pt-8">
          <EmptyState
            emoji="Ticket"
            title="No tickets yet"
            description="Add your flights, train passes, museum entries, and other purchases here."
          />
        </div>
      ) : (
        <div className="px-4 pt-4 pb-4 space-y-4">
          {grouped.map(({ type, items }) => (
            <TicketGroup
              key={type}
              type={type as TicketType}
              items={items}
              onSelect={(t) => {
                setSelected(t);
                setDetailOpen(true);
              }}
            />
          ))}
        </div>
      )}

      {/* ─── Add sheet ─────────────────────────────────────────────────── */}
      <Sheet
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setSubmitError(null);
        }}
      >
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90dvh] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Add ticket</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 pb-2">
            <div className="space-y-1.5">
              <Label htmlFor="t-title">Title *</Label>
              <Input
                id="t-title"
                placeholder="e.g. Tokyo Tower admission"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.ticketType}
                onValueChange={(v) => setForm({ ...form, ticketType: v as TicketType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-vendor">Vendor / Platform</Label>
              <Input
                id="t-vendor"
                placeholder="e.g. Klook, Japan Airlines, Airbnb"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-ref">Confirmation / Booking code</Label>
              <Input
                id="t-ref"
                placeholder="e.g. AX-12345"
                value={form.referenceCode}
                onChange={(e) => setForm({ ...form, referenceCode: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-passenger">Passenger / Guest name</Label>
              <Input
                id="t-passenger"
                placeholder="Name on the ticket (optional)"
                value={form.passengerName}
                onChange={(e) => setForm({ ...form, passengerName: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="t-from">Valid from</Label>
                <Input
                  id="t-from"
                  type="datetime-local"
                  value={form.validFrom}
                  onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-until">Valid until</Label>
                <Input
                  id="t-until"
                  type="datetime-local"
                  value={form.validUntil}
                  onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="t-notes">Notes</Label>
              <Textarea
                id="t-notes"
                placeholder="Seat number, gate, special instructions…"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {submitError && <p className="text-xs text-destructive">{submitError}</p>}

            <Button
              className="w-full"
              onClick={() => void handleAdd()}
              disabled={submitting || !form.title.trim()}
            >
              {submitting ? "Saving..." : "Save ticket"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Detail sheet ─────────────────────────────────────────────── */}
      {selected && (
        <Sheet
          open={detailOpen}
          onOpenChange={(open) => {
            setDetailOpen(open);
          }}
        >
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[85dvh] overflow-y-auto">
            <SheetHeader className="mb-4">
              <SheetTitle className="text-left pr-6 leading-snug">{selected.title}</SheetTitle>
            </SheetHeader>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {TYPE_MAP[selected.ticket_type]?.label ?? selected.ticket_type}
                </Badge>
                {selected.vendor && (
                  <Badge variant="outline">{selected.vendor}</Badge>
                )}
              </div>

              {selected.reference_code && (
                <InfoRow label="Booking ref" value={selected.reference_code} mono />
              )}

              {selected.passenger_name && (
                <InfoRow label="Passenger" value={selected.passenger_name} />
              )}

              {(selected.valid_from || selected.valid_until) && (
                <InfoRow
                  label="Valid"
                  value={formatValidity(selected.valid_from, selected.valid_until)}
                />
              )}

              {selected.notes && (
                <div className="bg-[var(--secondary)] rounded-xl px-3 py-2.5">
                  <p className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1">
                    Notes
                  </p>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}

              <p className="text-[11px] text-[var(--muted-foreground)]">
                Added {formatRelative(selected.created_at)}
              </p>

              {canDelete(selected) && (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={deleting}
                >
                  Delete ticket
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* ─── Delete confirmation ────────────────────────────────────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="mx-4 max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>Delete ticket?</DialogTitle>
            <DialogDescription>
              &ldquo;{selected?.title}&rdquo; will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline" disabled={deleting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => selected && void handleDelete(selected.id)}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TicketGroup({
  type,
  items,
  onSelect,
}: {
  type: TicketType;
  items: TripTicket[];
  onSelect: (t: TripTicket) => void;
}) {
  const meta = TYPE_MAP[type];

  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--secondary)] dark:bg-[#111]">
        <span className="text-sm font-semibold text-[var(--foreground)]">
          {meta?.label ?? type}
        </span>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--border)] text-[var(--muted-foreground)]">
          {items.length}
        </span>
      </div>

      <div className="divide-y divide-[var(--border)]">
        {items.map((ticket) => (
          <button
            key={ticket.id}
            onClick={() => onSelect(ticket)}
            className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[var(--secondary)] active:bg-[var(--secondary)] transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ticket.title}</p>
              {(ticket.vendor || ticket.reference_code) && (
                <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 truncate">
                  {[ticket.vendor, ticket.reference_code].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>

            {ticket.valid_from && (
              <span className="text-[10px] text-[var(--muted-foreground)] shrink-0 bg-[var(--secondary)] border border-[var(--border)] px-1.5 py-0.5 rounded-full whitespace-nowrap">
                {formatDate(ticket.valid_from)}
              </span>
            )}

            <span className="text-[var(--muted-foreground)] text-sm shrink-0">{">"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 text-sm bg-[var(--secondary)] rounded-xl px-3 py-2">
      <span className="font-medium text-[var(--muted-foreground)] shrink-0 text-xs mt-0.5 w-24">
        {label}
      </span>
      <span className={mono ? "font-mono break-all" : "break-words"}>{value}</span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyForm() {
  return {
    ticketType: "other" as TicketType,
    title: "",
    vendor: "",
    referenceCode: "",
    passengerName: "",
    validFrom: "",
    validUntil: "",
    notes: "",
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatValidity(from: string | null, until: string | null): string {
  const f = from ? new Date(from).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const u = until ? new Date(until).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  if (f && u) return `${f} → ${u}`;
  if (f) return `From ${f}`;
  if (u) return `Until ${u}`;
  return "";
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

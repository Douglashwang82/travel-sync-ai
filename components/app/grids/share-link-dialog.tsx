"use client";

import { useState } from "react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ItemType } from "@/lib/types";
import type { SharedItem } from "@/app/api/app/trips/[tripId]/shared/route";

const TYPE_OPTIONS: Array<{ value: ItemType | "auto"; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant" },
  { value: "activity", label: "Activity" },
  { value: "flight", label: "Flight" },
  { value: "transport", label: "Transport" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (item: SharedItem) => void;
}

/**
 * URL-paste form that runs the same extraction pipeline as the LINE
 * `/share` command and surfaces the resulting tile in the bento grid.
 */
export function ShareLinkDialog({ tripId, open, onOpenChange, onAdded }: Props) {
  const [url, setUrl] = useState("");
  const [itemType, setItemType] = useState<ItemType | "auto">("auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setUrl("");
      setItemType("auto");
      setError(null);
      setSubmitting(false);
    }
    onOpenChange(next);
  }

  async function submit() {
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setError("Paste a link starting with http:// or https://");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await appFetchJson<{ item: SharedItem }>(
        `/api/app/trips/${tripId}/shared`,
        {
          method: "POST",
          body: JSON.stringify({
            url: trimmed,
            ...(itemType !== "auto" ? { itemType } : {}),
          }),
        },
      );
      onAdded(res.item);
      handleOpenChange(false);
    } catch (err) {
      const message =
        err instanceof AppApiFetchError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to share link";
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share a link</DialogTitle>
          <DialogDescription>
            Paste a hotel, restaurant, flight, or activity URL. We&apos;ll pull
            the details and add it to this trip.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
            {error}
          </div>
        )}

        <div className="grid gap-3">
          <div className="grid gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              URL
            </label>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="https://booking.com/hotel/…"
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-base)] px-3 py-2 text-sm"
            />
          </div>

          <div className="grid gap-1">
            <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Type
            </label>
            <select
              value={itemType}
              onChange={(e) =>
                setItemType(e.target.value as ItemType | "auto")
              }
              className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-base)] px-3 py-2 text-sm"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
            className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-sm hover:border-[var(--border-strong)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || url.trim().length === 0}
            className="rounded-md bg-[var(--accent-line)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Fetching…" : "Share"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

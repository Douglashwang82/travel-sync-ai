"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import { countryColor } from "./day-cell";
import type { AvailableCountriesResponse } from "@/app/api/app/trips/[tripId]/holidays/route";

/**
 * Dialog for picking which countries' holidays to render on the calendar.
 * The list of available countries comes from Nager via our /holidays route
 * (cached server-side). Up to 20 selections.
 */
export function CountryPicker({
  tripId,
  open,
  onOpenChange,
  selected,
  onSave,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  onSave: (codes: string[]) => Promise<void> | void;
}) {
  const [countries, setCountries] = useState<
    { countryCode: string; name: string }[]
  >([]);
  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selected));
    setLoading(true);
    void (async () => {
      try {
        const res = await appFetchJson<AvailableCountriesResponse>(
          `/api/app/trips/${tripId}/holidays?list=countries`
        );
        setCountries(res.countries);
      } catch {
        setCountries([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, selected, tripId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.countryCode.toLowerCase().includes(q)
    );
  }, [countries, search]);

  function toggle(code: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else if (next.size < 20) next.add(code);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(Array.from(draft));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Holidays to show</DialogTitle>
          <DialogDescription>
            Pick the countries whose public holidays appear on this calendar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code (e.g. JP)"
            className="h-8 text-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {Array.from(draft).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => toggle(code)}
                className="inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: countryColor(code) }}
              >
                <span>{code}</span>
                <span aria-hidden>×</span>
              </button>
            ))}
            {draft.size === 0 && (
              <span className="text-[11px] text-[var(--text-muted)]">
                None selected — no holidays will render.
              </span>
            )}
          </div>

          <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-1">
            {loading ? (
              <p className="px-2 py-3 text-xs text-[var(--text-muted)]">
                Loading countries…
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-xs text-[var(--text-muted)]">
                No matches.
              </p>
            ) : (
              filtered.map((c) => {
                const isSelected = draft.has(c.countryCode);
                return (
                  <button
                    key={c.countryCode}
                    type="button"
                    onClick={() => toggle(c.countryCode)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-1 text-left text-xs hover:bg-[var(--surface-sunken)]",
                      isSelected && "bg-[var(--accent-line-soft)]"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: countryColor(c.countryCode) }}
                      />
                      <span className="font-medium">{c.countryCode}</span>
                      <span className="text-[var(--text-muted)]">{c.name}</span>
                    </span>
                    {isSelected && (
                      <span className="text-[var(--accent-line)]">✓</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

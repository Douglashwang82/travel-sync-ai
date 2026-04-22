"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { appFetchJson } from "@/lib/app-client";
import type { Trip, TripTemplate, TripTemplateVersion } from "@/lib/types";

export function TripPublishClient({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const tagInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<{ trip: Trip }>(`/api/app/trips/${tripId}`);
      setTrip(res.trip);
      setTitle(res.trip.title ?? res.trip.destination_name ?? "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load trip");
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/,/g, "");
    if (!tag || tags.includes(tag) || tags.length >= 10) return;
    setTags((prev) => [...prev, tag]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        summary: summary.trim() || null,
        coverImageUrl: coverImageUrl.trim() || null,
        tags,
      };
      const res = await appFetchJson<{ template: TripTemplate; version: TripTemplateVersion }>(
        `/api/app/trips/${tripId}/publish`,
        { method: "POST", body: JSON.stringify(payload) }
      );
      router.push(`/app/templates/${res.template.slug}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to publish template");
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {loadError}
      </div>
    );
  }

  if (!trip) {
    return <div className="h-64 animate-pulse rounded-2xl bg-[var(--secondary)]" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Publish as template</h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          Share your trip itinerary so others can use it as a starting point. Sensitive data
          (expenses, tickets, member info) will not be included.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
        <div className="space-y-1.5">
          <Label htmlFor="tmpl-title">Template title</Label>
          <Input
            id="tmpl-title"
            placeholder="5-day Osaka foodie trip"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tmpl-summary">Summary (optional)</Label>
          <Textarea
            id="tmpl-summary"
            placeholder="A quick description of what makes this trip special..."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            maxLength={1000}
            rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tmpl-cover">Cover image URL (optional)</Label>
          <Input
            id="tmpl-cover"
            type="url"
            placeholder="https://..."
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tmpl-tags">Tags (up to 10)</Label>
          <div
            className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm cursor-text focus-within:ring-1 focus-within:ring-[var(--ring)]"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs font-medium"
              >
                {tag}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] leading-none"
                  aria-label={`Remove tag ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
            {tags.length < 10 && (
              <input
                ref={tagInputRef}
                id="tmpl-tags"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => addTag(tagInput)}
                placeholder={tags.length === 0 ? "family, budget, 5-days… press Enter" : ""}
                className="min-w-[8rem] flex-1 bg-transparent outline-none placeholder:text-[var(--muted-foreground)] text-xs"
              />
            )}
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Press Enter or comma to add a tag.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40 p-3 text-xs text-[var(--muted-foreground)] space-y-1">
          <p className="font-medium text-[var(--foreground)]">What gets included</p>
          <p>Trip destination · {trip.start_date && trip.end_date ? `${countDays(trip.start_date, trip.end_date)}-day duration` : "duration"} · all planning items (title &amp; notes only)</p>
          <p className="font-medium text-[var(--foreground)] pt-1">What gets excluded</p>
          <p>Expenses · tickets · member names · prices · booking references</p>
        </div>

        {submitError && (
          <p className="text-xs text-destructive">{submitError}</p>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting || !title.trim()}>
            {submitting ? "Publishing…" : "Publish template"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function countDays(startDate: string, endDate: string): number {
  const diff = Math.round(
    (new Date(endDate + "T00:00:00").getTime() - new Date(startDate + "T00:00:00").getTime()) /
      86_400_000
  );
  return Math.max(1, diff + 1);
}

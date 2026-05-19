"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ITEM_TYPES = ["hotel", "restaurant", "activity", "transport", "other"] as const;
type ItemType = (typeof ITEM_TYPES)[number];

interface FormState {
  place_id: string;
  destination_name: string;
  destination_aliases: string;
  name: string;
  item_type: ItemType;
  tags: string;
  description: string;
  lat: string;
  lng: string;
  source: string;
}

const INITIAL: FormState = {
  place_id: "",
  destination_name: "",
  destination_aliases: "",
  name: "",
  item_type: "restaurant",
  tags: "",
  description: "",
  lat: "",
  lng: "",
  source: "admin_upload",
};

export function NewPoiForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);

    const latNum = form.lat.trim() ? Number(form.lat) : null;
    const lngNum = form.lng.trim() ? Number(form.lng) : null;
    if (form.lat.trim() && !Number.isFinite(latNum)) {
      setError("lat must be a number");
      setBusy(false);
      return;
    }
    if (form.lng.trim() && !Number.isFinite(lngNum)) {
      setError("lng must be a number");
      setBusy(false);
      return;
    }

    const payload = {
      place_id: form.place_id.trim(),
      destination_name: form.destination_name.trim(),
      destination_aliases: form.destination_aliases
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      name: form.name.trim(),
      item_type: form.item_type,
      tags: form.tags
        .split(",")
        .map((s) => s.trim().toLowerCase().replace(/\s+/g, "_"))
        .filter(Boolean),
      description: form.description.trim(),
      lat: latNum,
      lng: lngNum,
      source: form.source.trim() || "admin_upload",
    };

    try {
      const res = await fetch("/api/admin/pois", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; place_id?: string };
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      setSuccess(`Saved ${body.place_id ?? payload.place_id}`);
      setForm(INITIAL);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200">
          {success}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="place_id *" hint="Use a stable unique key. e.g. 'local:kyoto/kennin-ji' or a Google place_id.">
          <input
            required
            value={form.place_id}
            onChange={(e) => update("place_id", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm font-mono"
            placeholder="local:my-region/my-id"
          />
        </Field>

        <Field label="name *">
          <input
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="Kennin-ji Temple"
          />
        </Field>

        <Field label="destination_name *" hint="Canonical destination. e.g. 'Kyoto, Japan'.">
          <input
            required
            value={form.destination_name}
            onChange={(e) => update("destination_name", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="Kyoto, Japan"
          />
        </Field>

        <Field label="destination_aliases" hint="Comma-separated. Lowercased + deduped on save.">
          <input
            value={form.destination_aliases}
            onChange={(e) => update("destination_aliases", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="kyoto, 京都, japan"
          />
        </Field>

        <Field label="item_type *">
          <select
            value={form.item_type}
            onChange={(e) => update("item_type", e.target.value as ItemType)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
          >
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="tags" hint="Comma-separated. Used by the embedding text.">
          <input
            value={form.tags}
            onChange={(e) => update("tags", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="temple, culture, zen"
          />
        </Field>

        <Field label="lat">
          <input
            value={form.lat}
            onChange={(e) => update("lat", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="35.0036"
            inputMode="decimal"
          />
        </Field>

        <Field label="lng">
          <input
            value={form.lng}
            onChange={(e) => update("lng", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="135.7741"
            inputMode="decimal"
          />
        </Field>

        <Field label="source">
          <input
            value={form.source}
            onChange={(e) => update("source", e.target.value)}
            className="h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
            placeholder="admin_upload"
          />
        </Field>
      </div>

      <Field
        label="description"
        hint="Free-form text. If blank, a description is auto-built from name + type + destination + tags. This is the text that gets embedded."
      >
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={4}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
          placeholder="Zen temple in Higashiyama with dragon ceiling and rock gardens. Quiet morning visit, ~1 hour."
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[var(--primary)] px-5 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Embedding + saving…" : "Save POI"}
        </button>
        <span className="text-xs text-[var(--muted-foreground)]">
          Re-saving the same place_id updates the row and refreshes the embedding.
        </span>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-[var(--foreground)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--muted-foreground)]">{hint}</span>}
    </label>
  );
}

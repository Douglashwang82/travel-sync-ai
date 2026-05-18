"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PoiItemType } from "@/services/admin/poi-upsert";

export interface PoiRow {
  place_id: string;
  destination_name: string;
  destination_aliases: string[] | null;
  name: string;
  item_type: PoiItemType;
  tags: string[] | null;
  description: string;
  lat: number | null;
  lng: number | null;
  source: string;
  last_seen_at: string;
}

const ITEM_TYPES: PoiItemType[] = ["hotel", "restaurant", "activity", "transport", "other"];

interface DraftPatch {
  name?: string;
  destination_name?: string;
  item_type?: PoiItemType;
  tags?: string[];
  description?: string;
  destination_aliases?: string[];
  lat?: number | null;
  lng?: number | null;
}

export function PoisTable({ rows }: { rows: PoiRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftPatch>({});
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--muted-foreground)]">
        No POIs matched. Try adjusting your filters or adding a new POI.
      </div>
    );
  }

  function startEdit(row: PoiRow) {
    setEditingId(row.place_id);
    setDraft({
      name: row.name,
      destination_name: row.destination_name,
      item_type: row.item_type,
      tags: row.tags ?? [],
      description: row.description,
      destination_aliases: row.destination_aliases ?? [],
      lat: row.lat,
      lng: row.lng,
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft({});
    setError(null);
  }

  async function saveEdit(placeId: string) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/pois/${encodeURIComponent(placeId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setEditingId(null);
      setDraft({});
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(placeId: string) {
    if (!confirm(`Delete ${placeId}? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/pois/${encodeURIComponent(placeId)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200">
          {error}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--secondary)]/40 text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Destination</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Tags</th>
              <th className="px-3 py-2">place_id</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isEditing = editingId === row.place_id;
              return (
                <tr key={row.place_id} className="border-b border-[var(--border)] last:border-0 align-top">
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                        value={draft.name ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                      />
                    ) : (
                      <div className="font-medium">{row.name}</div>
                    )}
                    {isEditing ? (
                      <textarea
                        className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                        rows={2}
                        value={draft.description ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                        placeholder="Description (powers embeddings)"
                      />
                    ) : (
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">{row.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {isEditing ? (
                      <>
                        <input
                          className="w-44 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                          value={draft.destination_name ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, destination_name: e.target.value }))}
                        />
                        <input
                          className="mt-1 w-44 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          value={(draft.destination_aliases ?? []).join(", ")}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              destination_aliases: e.target.value
                                .split(",")
                                .map((s) => s.trim().toLowerCase())
                                .filter(Boolean),
                            }))
                          }
                          placeholder="aliases (comma)"
                        />
                      </>
                    ) : (
                      <>
                        <div>{row.destination_name}</div>
                        {(row.destination_aliases?.length ?? 0) > 0 && (
                          <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
                            aliases: {row.destination_aliases?.join(", ")}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {isEditing ? (
                      <select
                        className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                        value={draft.item_type ?? row.item_type}
                        onChange={(e) => setDraft((d) => ({ ...d, item_type: e.target.value as PoiItemType }))}
                      >
                        {ITEM_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[11px]">{row.item_type}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {isEditing ? (
                      <input
                        className="w-44 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                        value={(draft.tags ?? []).join(", ")}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            tags: e.target.value
                              .split(",")
                              .map((s) => s.trim().toLowerCase().replace(/\s+/g, "_"))
                              .filter(Boolean),
                          }))
                        }
                        placeholder="comma-separated"
                      />
                    ) : (row.tags?.length ?? 0) === 0 ? (
                      <span className="text-[var(--muted-foreground)]">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {row.tags!.slice(0, 4).map((t) => (
                          <span key={t} className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px]">
                            {t}
                          </span>
                        ))}
                        {row.tags!.length > 4 && (
                          <span className="text-[10px] text-[var(--muted-foreground)]">+{row.tags!.length - 4}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--muted-foreground)]">
                    <div className="truncate" title={row.place_id}>
                      {row.place_id}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {isEditing ? (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => saveEdit(row.place_id)}
                          disabled={busy}
                          className="rounded-md bg-[var(--primary)] px-3 py-1 text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={busy}
                          className="rounded-md border border-[var(--border)] px-3 py-1 hover:bg-[var(--secondary)]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => startEdit(row)}
                          className="rounded-md border border-[var(--border)] px-3 py-1 hover:bg-[var(--secondary)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => remove(row.place_id)}
                          className="rounded-md border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/30"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

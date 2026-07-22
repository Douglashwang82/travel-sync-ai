"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PoiItemType } from "@/services/admin/poi-upsert";
import {
  CURATION_STATUSES,
  POI_CATEGORIES,
  type CurationStatus,
  type PoiCategory,
} from "@/services/admin/poi-curation";

export interface PoiRowStats {
  exposures: number;
  selections: number;
  selection_rate: number;
}

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
  category: PoiCategory | null;
  labels: string[] | null;
  curation_status: CurationStatus;
  quality_score: number | null;
  /** itinerary_feedback aggregates; null when the POI never hit a shortlist. */
  stats?: PoiRowStats | null;
  /** Recency-decayed social trend score (0–1); 0 when no live signal. */
  trend_score?: number;
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
  category?: PoiCategory | null;
  labels?: string[];
  curation_status?: CurationStatus;
  quality_score?: number | null;
}

const STATUS_STYLES: Record<CurationStatus, string> = {
  unreviewed: "bg-[var(--secondary)] text-[var(--muted-foreground)]",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  hidden: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
};

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
      category: row.category,
      labels: row.labels ?? [],
      curation_status: row.curation_status,
      quality_score: row.quality_score,
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
        <table className="w-full min-w-[1280px] text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--secondary)]/40 text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Destination</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Tags</th>
              <th className="px-3 py-2">Curation</th>
              <th className="px-3 py-2">Signals</th>
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
                  <td className="px-3 py-2 text-xs">
                    {isEditing ? (
                      <div className="flex w-44 flex-col gap-1">
                        <select
                          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          value={draft.category ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, category: (e.target.value || null) as PoiCategory | null }))
                          }
                        >
                          <option value="">(no category)</option>
                          {POI_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <select
                          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          value={draft.curation_status ?? row.curation_status}
                          onChange={(e) => setDraft((d) => ({ ...d, curation_status: e.target.value as CurationStatus }))}
                        >
                          {CURATION_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <input
                          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          value={(draft.labels ?? []).join(", ")}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              labels: e.target.value
                                .split(",")
                                .map((s) => s.trim().toLowerCase().replace(/\s+/g, "_"))
                                .filter(Boolean),
                            }))
                          }
                          placeholder="labels (comma)"
                        />
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          value={draft.quality_score ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              quality_score: e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          placeholder="quality 0–1"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[row.curation_status]}`}>
                            {row.curation_status}
                          </span>
                          {row.category ? (
                            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px]">{row.category}</span>
                          ) : (
                            <span className="text-[10px] text-[var(--muted-foreground)]">no category</span>
                          )}
                          {row.quality_score != null && (
                            <span className="rounded-full bg-[var(--secondary)] px-2 py-0.5 text-[10px]">
                              q={row.quality_score.toFixed(2)}
                            </span>
                          )}
                        </div>
                        {(row.labels?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {row.labels!.slice(0, 3).map((l) => (
                              <span key={l} className="rounded-full border border-dashed border-[var(--border)] px-2 py-0.5 text-[10px]">
                                {l}
                              </span>
                            ))}
                            {row.labels!.length > 3 && (
                              <span className="text-[10px] text-[var(--muted-foreground)]">+{row.labels!.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {row.stats ? (
                      <div className="space-y-0.5">
                        <div>
                          <span className="font-medium">{Math.round(row.stats.selection_rate * 100)}%</span>{" "}
                          <span className="text-[var(--muted-foreground)]">
                            picked ({row.stats.selections}/{row.stats.exposures})
                          </span>
                        </div>
                        {(row.trend_score ?? 0) > 0 && (
                          <div className="text-[10px] text-orange-600 dark:text-orange-400">
                            🔥 trend {(row.trend_score ?? 0).toFixed(2)}
                          </div>
                        )}
                      </div>
                    ) : (row.trend_score ?? 0) > 0 ? (
                      <div className="text-[10px] text-orange-600 dark:text-orange-400">
                        🔥 trend {(row.trend_score ?? 0).toFixed(2)} · never shortlisted
                      </div>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">—</span>
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

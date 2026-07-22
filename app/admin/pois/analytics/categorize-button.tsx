"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * One-click bulk heuristic categorization for rows still missing a category.
 * Calls POST /api/admin/pois/categorize and refreshes the dashboard.
 */
export function CategorizeButton({ uncategorized }: { uncategorized: number }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setMessage(null);
    try {
      const res = await fetch("/api/admin/pois/categorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as { updated?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
      setMessage(`Categorized ${body.updated ?? 0} POIs.`);
      startTransition(() => router.refresh());
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={busy || uncategorized === 0}
        className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Working…" : `Auto-categorize ${uncategorized} POIs`}
      </button>
      {message && <span className="text-xs text-[var(--muted-foreground)]">{message}</span>}
    </div>
  );
}

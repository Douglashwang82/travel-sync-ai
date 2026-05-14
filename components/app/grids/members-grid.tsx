"use client";

import { useCallback, useEffect, useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import { GridTileError } from "@/components/app/grids/grid-tile";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";

export function MembersGrid({ tripId }: { tripId: string }) {
  const [members, setMembers] = useState<AppMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await appFetchJson<{ members: AppMember[] }>(
        `/api/app/trips/${tripId}/members`
      );
      setMembers(res.members);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members");
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  if (error) return <GridTileError message={error} onRetry={() => void load()} />;
  if (!members) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-12 rounded-[var(--radius-md)]" />
        ))}
      </div>
    );
  }
  if (members.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No members yet.</p>;
  }
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {members.map((m) => (
        <li
          key={m.lineUserId}
          className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-2.5 py-2"
        >
          <span
            aria-hidden
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-line-soft)] text-sm font-semibold text-[var(--accent-line)]"
          >
            {(m.displayName ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm text-[var(--text-primary)]">
              {m.displayName ?? "Unknown"}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              {m.role}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

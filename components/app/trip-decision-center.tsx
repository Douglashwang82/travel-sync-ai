"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { BoardData, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { WebActiveVote } from "@/app/api/app/trips/[tripId]/votes/route";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";

export function TripDecisionCenter({
  tripId,
  board,
  members,
  votes,
  onItemClick,
}: {
  tripId: string;
  board: BoardData;
  members: AppMember[];
  votes: WebActiveVote[];
  onItemClick: (item: TripItem) => void;
}) {
  const memberById = new Map(members.map((m) => [m.lineUserId, m]));

  const needsVote = board.pending;
  const missingOwner = board.todo.filter(
    (i) => i.assigned_to_line_user_id == null
  );
  const recentlyConfirmed = [...board.confirmed]
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
    .slice(0, 4);

  const totalDecisions =
    needsVote.length + missingOwner.length + recentlyConfirmed.length;

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--background)] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Decision center</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            What still needs to be decided, who&apos;s blocking, and what&apos;s
            already locked in.
          </p>
        </div>
        <Link
          href={`/app/trips/${tripId}/votes`}
          className="text-xs font-medium text-[var(--primary)] hover:underline"
        >
          Open all votes →
        </Link>
      </div>

      {totalDecisions === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
          Everything is decided. Nice work. ✨
        </p>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <DecisionGroup
            title="Needs vote"
            tone="amber"
            count={needsVote.length}
            empty="No active votes."
          >
            {needsVote.slice(0, 4).map((item) => {
              const vote = votes.find((v) => v.item.id === item.id);
              const memberCount = vote?.memberCount ?? members.length;
              const totalVotes = vote?.totalVotes ?? 0;
              const nonVoters = computeNonVoters(vote, members);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onItemClick(item)}
                  className="w-full space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--secondary)]/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {item.title}
                    </p>
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[10px] uppercase"
                    >
                      {ITEM_TYPE_LABELS[item.item_type] ?? "Item"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--muted-foreground)]">
                    <span>
                      {totalVotes}/{memberCount} voted
                    </span>
                    {nonVoters.length > 0 && (
                      <span className="truncate">
                        Waiting:{" "}
                        <span className="font-medium text-amber-700 dark:text-amber-300">
                          {nonVoters
                            .slice(0, 2)
                            .map((n) => n.displayName ?? "?")
                            .join(", ")}
                          {nonVoters.length > 2 && ` +${nonVoters.length - 2}`}
                        </span>
                      </span>
                    )}
                  </div>
                  {memberCount > 0 && (
                    <div className="h-1 overflow-hidden rounded-full bg-[var(--secondary)]">
                      <div
                        className="h-full bg-amber-500 transition-all"
                        style={{
                          width: `${Math.min(100, (totalVotes / memberCount) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
            {needsVote.length > 4 && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                +{needsVote.length - 4} more pending
              </p>
            )}
          </DecisionGroup>

          <DecisionGroup
            title="Waiting on owner"
            tone="muted"
            count={missingOwner.length}
            empty="Every to-do has an owner."
          >
            {missingOwner.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onItemClick(item)}
                className="w-full space-y-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--secondary)]/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <Badge
                    variant="secondary"
                    className="shrink-0 text-[10px] uppercase"
                  >
                    {ITEM_TYPE_LABELS[item.item_type] ?? "Item"}
                  </Badge>
                </div>
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Needs an owner · tap to assign
                </p>
              </button>
            ))}
            {missingOwner.length > 4 && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                +{missingOwner.length - 4} more
              </p>
            )}
          </DecisionGroup>

          <DecisionGroup
            title="Recently confirmed"
            tone="primary"
            count={board.confirmed.length}
            empty="Nothing confirmed yet."
          >
            {recentlyConfirmed.map((item) => {
              const owner = item.assigned_to_line_user_id
                ? memberById.get(item.assigned_to_line_user_id)
                : null;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onItemClick(item)}
                  className="w-full space-y-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--secondary)]/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">
                      {item.title}
                    </p>
                    {item.booking_status === "needed" ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        Book
                      </span>
                    ) : item.booking_status === "booked" ? (
                      <span className="shrink-0 rounded-full bg-[#dcfce7] px-1.5 py-0.5 text-[9px] font-semibold text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
                        ✓ Booked
                      </span>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px] uppercase"
                      >
                        {ITEM_TYPE_LABELS[item.item_type] ?? "Item"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {owner ? `Owner: ${owner.displayName ?? "?"}` : "Locked in"}
                  </p>
                </button>
              );
            })}
          </DecisionGroup>
        </div>
      )}
    </section>
  );
}

function DecisionGroup({
  title,
  tone,
  count,
  empty,
  children,
}: {
  title: string;
  tone: "amber" | "muted" | "primary";
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  const accent =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-300"
      : tone === "primary"
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-[var(--muted-foreground)]";
  const dotClass =
    tone === "amber"
      ? "bg-amber-500"
      : tone === "primary"
        ? "bg-emerald-500"
        : "bg-[var(--muted-foreground)]";
  const isEmpty =
    !children ||
    (Array.isArray(children) &&
      children.filter(Boolean).length === 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
        <h3 className={cn("text-xs font-semibold uppercase tracking-wide", accent)}>
          {title}
        </h3>
        <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
          {count}
        </span>
      </div>
      {isEmpty ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-[11px] italic text-[var(--muted-foreground)]">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

function computeNonVoters(
  vote: WebActiveVote | undefined,
  members: AppMember[]
): AppMember[] {
  if (!vote) return [];
  const voted = new Set<string>();
  for (const opt of vote.options) {
    for (const v of opt.voters) voted.add(v.lineUserId);
  }
  return members.filter((m) => !voted.has(m.lineUserId));
}

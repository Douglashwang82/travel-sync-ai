"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import type { BoardData, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { WebActiveVote } from "@/app/api/app/trips/[tripId]/votes/route";
import type { NudgeResponse } from "@/app/api/app/trips/[tripId]/votes/[itemId]/nudge/route";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";

type ActionKind = "vote" | "book" | "assign" | "approve" | "nudge";
type Priority = "critical" | "high" | "medium" | "low";

interface ActionRow {
  id: string;
  kind: ActionKind;
  priority: Priority;
  score: number;
  title: string;
  itemTypeLabel: string;
  reason: string;
  deadlineAt: string | null;
  item: TripItem;
  // For nudge: who to ping
  nudgeTargetIds?: string[];
  nudgeWaitingNames?: string[];
}

const KIND_ICON: Record<ActionKind, string> = {
  vote: "🗳",
  book: "📅",
  assign: "👤",
  approve: "✨",
  nudge: "🔔",
};

const KIND_LABEL: Record<ActionKind, string> = {
  vote: "Vote",
  book: "Book",
  assign: "Assign owner",
  approve: "Review",
  nudge: "Nudge",
};

const KIND_PRIMARY_LABEL: Record<ActionKind, string> = {
  vote: "Vote now",
  book: "Mark booked",
  assign: "Assign",
  approve: "Review",
  nudge: "Nudge",
};

const PRIORITY_DOT: Record<Priority, string> = {
  critical: "bg-red-500",
  high: "bg-amber-500",
  medium: "bg-[var(--primary)]",
  low: "bg-[var(--muted-foreground)]",
};

interface BuildArgs {
  board: BoardData;
  votes: WebActiveVote[];
  members: AppMember[];
  currentUserId: string;
}

function deadlineUrgencyBoost(deadlineAt: string | null): number {
  if (!deadlineAt) return 0;
  const diff = new Date(deadlineAt).getTime() - Date.now();
  if (diff <= 0) return 50; // overdue
  const hours = diff / 3_600_000;
  if (hours < 6) return 35;
  if (hours < 24) return 20;
  if (hours < 72) return 10;
  return 0;
}

function buildActions({
  board,
  votes,
  members,
  currentUserId,
}: BuildArgs): ActionRow[] {
  const rows: ActionRow[] = [];
  const allItems: TripItem[] = [
    ...board.todo,
    ...board.pending,
    ...board.confirmed,
  ];
  const itemById = new Map<string, TripItem>(allItems.map((i) => [i.id, i]));
  const memberById = new Map<string, AppMember>(
    members.map((m) => [m.lineUserId, m])
  );

  // 1. Pending votes — what action does *this user* need to take?
  for (const vote of votes) {
    const item = itemById.get(vote.item.id);
    if (!item) continue;
    const voted = new Set<string>();
    for (const opt of vote.options) for (const v of opt.voters) voted.add(v.lineUserId);
    const myVote = vote.options.find((o) => o.votedByMe);
    const urgency = deadlineUrgencyBoost(vote.item.deadlineAt);

    if (!myVote) {
      const score = 80 + urgency;
      rows.push({
        id: `vote:${item.id}`,
        kind: "vote",
        priority: score >= 100 ? "critical" : score >= 90 ? "high" : "medium",
        score,
        title: vote.item.title,
        itemTypeLabel: ITEM_TYPE_LABELS[item.item_type] ?? "Item",
        reason: `${vote.options.length} option${vote.options.length === 1 ? "" : "s"} · ${vote.totalVotes}/${vote.memberCount} voted`,
        deadlineAt: vote.item.deadlineAt,
        item,
      });
    } else {
      // I've voted — surface non-voters as a nudge action when others are blocking
      const nonVoters = members.filter(
        (m) => !voted.has(m.lineUserId) && m.lineUserId !== currentUserId
      );
      if (nonVoters.length > 0) {
        const score = 40 + urgency;
        rows.push({
          id: `nudge:${item.id}`,
          kind: "nudge",
          priority: score >= 70 ? "high" : "medium",
          score,
          title: vote.item.title,
          itemTypeLabel: ITEM_TYPE_LABELS[item.item_type] ?? "Item",
          reason: `Waiting on ${nonVoters
            .slice(0, 2)
            .map((n) => n.displayName ?? "?")
            .join(", ")}${nonVoters.length > 2 ? ` +${nonVoters.length - 2}` : ""}`,
          deadlineAt: vote.item.deadlineAt,
          item,
          nudgeTargetIds: nonVoters.map((n) => n.lineUserId),
          nudgeWaitingNames: nonVoters.map((n) => n.displayName ?? "?"),
        });
      }
    }
  }

  // 2. To-do items missing an owner
  for (const item of board.todo) {
    if (item.assigned_to_line_user_id != null) continue;
    const score = 55 + deadlineUrgencyBoost(item.deadline_at);
    rows.push({
      id: `assign:${item.id}`,
      kind: "assign",
      priority: score >= 90 ? "high" : "medium",
      score,
      title: item.title,
      itemTypeLabel: ITEM_TYPE_LABELS[item.item_type] ?? "Item",
      reason: "No owner — pick someone to drive this",
      deadlineAt: item.deadline_at,
      item,
    });
  }

  // 3. Confirmed items needing booking
  for (const item of board.confirmed) {
    if (item.booking_status !== "needed") continue;
    const score = 35 + deadlineUrgencyBoost(item.deadline_at);
    rows.push({
      id: `book:${item.id}`,
      kind: "book",
      priority: score >= 80 ? "high" : score >= 50 ? "medium" : "low",
      score,
      title: item.title,
      itemTypeLabel: ITEM_TYPE_LABELS[item.item_type] ?? "Item",
      reason: "Confirmed but not yet booked",
      deadlineAt: item.deadline_at,
      item,
    });
  }

  // 4. AI-extracted items still in to-do — likely need a human review
  for (const item of board.todo) {
    if (item.source !== "ai") continue;
    // Skip if we already surfaced as assign (avoid double-row)
    const owner = item.assigned_to_line_user_id;
    const ownerName = owner
      ? memberById.get(owner)?.displayName ?? "owner"
      : null;
    if (owner == null) continue; // already surfaced as assign
    const score = 45;
    rows.push({
      id: `approve:${item.id}`,
      kind: "approve",
      priority: "medium",
      score,
      title: item.title,
      itemTypeLabel: ITEM_TYPE_LABELS[item.item_type] ?? "Item",
      reason: `AI extracted · ${ownerName ? `assigned to ${ownerName}` : "review needed"}`,
      deadlineAt: item.deadline_at,
      item,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows;
}

export function TripActionQueue({
  tripId,
  board,
  votes,
  members,
  currentUserId,
  onItemClick,
  onAfterNudge,
}: {
  tripId: string;
  board: BoardData;
  votes: WebActiveVote[];
  members: AppMember[];
  currentUserId: string;
  onItemClick: (item: TripItem) => void;
  onAfterNudge?: () => void;
}) {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    rowId: string;
    text: string;
    tone: "ok" | "info" | "err";
  } | null>(null);

  const all = useMemo(
    () => buildActions({ board, votes, members, currentUserId }),
    [board, votes, members, currentUserId]
  );

  const filtered = useMemo(() => {
    if (scope === "all") return all;
    // "Mine" = items where I'm the blocker (vote needed) or I am the owner
    return all.filter((row) => {
      if (row.kind === "vote") return true;
      if (row.item.assigned_to_line_user_id === currentUserId) return true;
      return false;
    });
  }, [all, scope, currentUserId]);

  async function handleNudge(row: ActionRow) {
    if (!row.nudgeTargetIds?.length) return;
    setNudgingId(row.id);
    setFeedback(null);
    try {
      const res = await appFetchJson<NudgeResponse>(
        `/api/app/trips/${tripId}/votes/${row.item.id}/nudge`,
        {
          method: "POST",
          body: JSON.stringify({ lineUserIds: row.nudgeTargetIds }),
        }
      );
      const cooled = res.skipped.filter((s) => s.reason === "cooldown").length;
      const sent = res.nudged.length;
      setFeedback({
        rowId: row.id,
        text:
          sent === 0
            ? cooled > 0
              ? `Already nudged in last 30 min`
              : `Nothing to nudge`
            : `Nudged ${sent}${cooled > 0 ? ` · ${cooled} on cooldown` : ""}`,
        tone: sent === 0 ? "info" : "ok",
      });
      onAfterNudge?.();
    } catch (err) {
      setFeedback({
        rowId: row.id,
        text:
          err instanceof AppApiFetchError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Nudge failed",
        tone: "err",
      });
    } finally {
      setNudgingId(null);
    }
  }

  const myCount = all.filter(
    (r) =>
      r.kind === "vote" || r.item.assigned_to_line_user_id === currentUserId
  ).length;

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--background)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold">Action queue</h2>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            {all.length === 0
              ? "Nothing waiting on the group right now ✨"
              : `${all.length} action${all.length === 1 ? "" : "s"} ranked by priority`}
          </p>
        </div>
        <div className="flex rounded-full border border-[var(--border)] p-0.5 text-[11px]">
          {(
            [
              { v: "all", label: "Everyone", count: all.length },
              { v: "mine", label: "Mine", count: myCount },
            ] as const
          ).map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => setScope(s.v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors",
                scope === s.v
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {s.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold",
                  scope === s.v
                    ? "bg-[var(--background)]/20"
                    : "bg-[var(--secondary)]"
                )}
              >
                {s.count}
              </span>
            </button>
          ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[var(--muted-foreground)]">
          {scope === "mine"
            ? "Nothing on your plate. ✨"
            : "All clear. Plan something or wait for the group."}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {filtered.map((row) => (
            <li key={row.id} className="px-4 py-3 sm:px-5">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    PRIORITY_DOT[row.priority]
                  )}
                  title={`${row.priority} priority`}
                />
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--secondary)] text-base"
                >
                  {KIND_ICON[row.kind]}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      {KIND_LABEL[row.kind]}
                    </span>
                    <Badge variant="secondary" className="text-[9px] uppercase">
                      {row.itemTypeLabel}
                    </Badge>
                    {row.deadlineAt && <DeadlinePill iso={row.deadlineAt} />}
                  </div>
                  <button
                    type="button"
                    onClick={() => onItemClick(row.item)}
                    className="block w-full text-left"
                  >
                    <p className="truncate text-sm font-medium hover:underline">
                      {row.title}
                    </p>
                  </button>
                  <p className="truncate text-[11px] text-[var(--muted-foreground)]">
                    {row.reason}
                  </p>
                  {feedback?.rowId === row.id && (
                    <p
                      className={cn(
                        "text-[11px]",
                        feedback.tone === "ok"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : feedback.tone === "err"
                            ? "text-red-700 dark:text-red-300"
                            : "text-[var(--muted-foreground)]"
                      )}
                    >
                      {feedback.text}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {row.kind === "nudge" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      disabled={nudgingId === row.id}
                      onClick={() => void handleNudge(row)}
                    >
                      {nudgingId === row.id
                        ? "Nudging…"
                        : KIND_PRIMARY_LABEL[row.kind]}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => onItemClick(row.item)}
                    >
                      {KIND_PRIMARY_LABEL[row.kind]}
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeadlinePill({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(iso).getTime() - now;
  const overdue = diff <= 0;
  const hours = Math.abs(diff) / 3_600_000;
  let label: string;
  if (overdue) label = "Overdue";
  else if (hours < 1) label = `${Math.floor((Math.abs(diff) % 3_600_000) / 60_000)}m left`;
  else if (hours < 24) label = `${Math.floor(hours)}h left`;
  else label = `${Math.floor(hours / 24)}d left`;

  const tone = overdue || hours < 2
    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
    : hours < 12
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-[var(--secondary)] text-[var(--muted-foreground)]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        tone
      )}
    >
      ⏱ {label}
    </span>
  );
}

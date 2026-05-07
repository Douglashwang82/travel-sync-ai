"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import type { BoardData, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { WebActiveVote } from "@/app/api/app/trips/[tripId]/votes/route";
import type { NudgeResponse } from "@/app/api/app/trips/[tripId]/votes/[itemId]/nudge/route";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";
import { IconBell, IconBolt, IconClock, IconUsers, IconVote, IconCheck } from "@/components/app/icons";

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
  nudgeTargetIds?: string[];
}

const COPY = {
  en: {
    title: "Action queue",
    subTotal: (n: number) => `${n} action${n === 1 ? "" : "s"} ranked by priority`,
    subEmpty: "Nothing waiting on the group right now.",
    everyone: "Everyone",
    mine: "Mine",
    noneMine: "Nothing on your plate.",
    noneAll: "All clear. Plan something or wait for the group.",
    pickOwner: "No owner — pick someone to drive this",
    confirmedNeedsBooking: "Confirmed but not yet booked",
    aiExtracted: "AI extracted",
    waiting: (names: string) => `Waiting on ${names}`,
    vote: "Vote",
    book: "Book",
    assign: "Assign",
    review: "Review",
    nudge: "Nudge",
    nudging: "Nudging…",
    nudgedSent: (n: number) => `Nudged ${n}`,
    nudgedCool: "Already nudged in last 30 min",
    nudgedNothing: "Nothing to nudge",
    cooldown: (n: number) => ` · ${n} on cooldown`,
    overdue: "Overdue",
    minLeft: (m: number) => `${m}m left`,
    hLeft: (h: number) => `${h}h left`,
    dLeft: (d: number) => `${d}d left`,
    optionCount: (n: number) => `${n} option${n === 1 ? "" : "s"}`,
    voted: (taken: number, total: number) => `${taken}/${total} voted`,
  },
  "zh-TW": {
    title: "行動清單",
    subTotal: (n: number) => `${n} 項依優先順序排列`,
    subEmpty: "目前沒有需要處理的事項。",
    everyone: "全部",
    mine: "我的",
    noneMine: "你已沒有待辦。",
    noneAll: "都搞定了。等等大家就好。",
    pickOwner: "沒有負責人 — 指派一位",
    confirmedNeedsBooking: "已確認但尚未預訂",
    aiExtracted: "AI 擷取",
    waiting: (names: string) => `等待 ${names}`,
    vote: "投票",
    book: "預訂",
    assign: "指派",
    review: "審核",
    nudge: "提醒",
    nudging: "提醒中…",
    nudgedSent: (n: number) => `已提醒 ${n} 人`,
    nudgedCool: "30 分鐘內已提醒過",
    nudgedNothing: "沒有可提醒的對象",
    cooldown: (n: number) => ` · ${n} 個冷卻中`,
    overdue: "逾期",
    minLeft: (m: number) => `剩 ${m} 分`,
    hLeft: (h: number) => `剩 ${h} 小時`,
    dLeft: (d: number) => `剩 ${d} 天`,
    optionCount: (n: number) => `${n} 個選項`,
    voted: (taken: number, total: number) => `${taken}/${total} 已投`,
  },
} as const;

const PRIORITY_DOT: Record<Priority, string> = {
  critical: "bg-[var(--status-blocked)]",
  high: "bg-[var(--status-needs-decision)]",
  medium: "bg-[var(--accent-line)]",
  low: "bg-[var(--text-faint)]",
};

const KIND_ICON: Record<ActionKind, (props: { size?: number }) => React.ReactElement> = {
  vote: (p) => <IconVote {...p} />,
  book: (p) => <IconCheck {...p} />,
  assign: (p) => <IconUsers {...p} />,
  approve: (p) => <IconBolt {...p} />,
  nudge: (p) => <IconBell {...p} />,
};

function deadlineUrgencyBoost(deadlineAt: string | null): number {
  if (!deadlineAt) return 0;
  const diff = new Date(deadlineAt).getTime() - Date.now();
  if (diff <= 0) return 50;
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
  copy,
}: {
  board: BoardData;
  votes: WebActiveVote[];
  members: AppMember[];
  currentUserId: string;
  copy: typeof COPY[keyof typeof COPY];
}): ActionRow[] {
  const rows: ActionRow[] = [];
  const allItems: TripItem[] = [...board.todo, ...board.pending, ...board.confirmed];
  const itemById = new Map<string, TripItem>(allItems.map((i) => [i.id, i]));
  const memberById = new Map<string, AppMember>(members.map((m) => [m.lineUserId, m]));

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
        reason: `${copy.optionCount(vote.options.length)} · ${copy.voted(vote.totalVotes, vote.memberCount)}`,
        deadlineAt: vote.item.deadlineAt,
        item,
      });
    } else {
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
          reason: copy.waiting(
            nonVoters.slice(0, 2).map((n) => n.displayName ?? "?").join(", ") +
              (nonVoters.length > 2 ? ` +${nonVoters.length - 2}` : "")
          ),
          deadlineAt: vote.item.deadlineAt,
          item,
          nudgeTargetIds: nonVoters.map((n) => n.lineUserId),
        });
      }
    }
  }

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
      reason: copy.pickOwner,
      deadlineAt: item.deadline_at,
      item,
    });
  }

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
      reason: copy.confirmedNeedsBooking,
      deadlineAt: item.deadline_at,
      item,
    });
  }

  for (const item of board.todo) {
    if (item.source !== "ai") continue;
    const owner = item.assigned_to_line_user_id;
    if (owner == null) continue;
    const ownerName = memberById.get(owner)?.displayName ?? "owner";
    rows.push({
      id: `approve:${item.id}`,
      kind: "approve",
      priority: "medium",
      score: 45,
      title: item.title,
      itemTypeLabel: ITEM_TYPE_LABELS[item.item_type] ?? "Item",
      reason: `${copy.aiExtracted} · ${ownerName}`,
      deadlineAt: item.deadline_at,
      item,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  return rows;
}

export function ActionQueueTile({
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
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ rowId: string; text: string; tone: "ok" | "info" | "err" } | null>(null);

  const all = useMemo(
    () => buildActions({ board, votes, members, currentUserId, copy }),
    [board, votes, members, currentUserId, copy]
  );

  const filtered = useMemo(() => {
    if (scope === "all") return all;
    return all.filter((row) => {
      if (row.kind === "vote") return true;
      if (row.item.assigned_to_line_user_id === currentUserId) return true;
      return false;
    });
  }, [all, scope, currentUserId]);

  const myCount = all.filter(
    (r) => r.kind === "vote" || r.item.assigned_to_line_user_id === currentUserId
  ).length;

  async function handleNudge(row: ActionRow) {
    if (!row.nudgeTargetIds?.length) return;
    setNudgingId(row.id);
    setFeedback(null);
    try {
      const res = await appFetchJson<NudgeResponse>(
        `/api/app/trips/${tripId}/votes/${row.item.id}/nudge`,
        { method: "POST", body: JSON.stringify({ lineUserIds: row.nudgeTargetIds }) }
      );
      const cooled = res.skipped.filter((s) => s.reason === "cooldown").length;
      const sent = res.nudged.length;
      setFeedback({
        rowId: row.id,
        text:
          sent === 0
            ? cooled > 0
              ? copy.nudgedCool
              : copy.nudgedNothing
            : `${copy.nudgedSent(sent)}${cooled > 0 ? copy.cooldown(cooled) : ""}`,
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

  const KIND_PRIMARY_LABEL: Record<ActionKind, string> = {
    vote: copy.vote,
    book: copy.book,
    assign: copy.assign,
    approve: copy.review,
    nudge: copy.nudge,
  };

  return (
    <section className="surface-tile flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-5 py-4">
        <div>
          <h2 className="text-display text-lg text-[var(--text-primary)]">{copy.title}</h2>
          <p className="text-[11px] text-[var(--text-muted)]">
            {all.length === 0 ? copy.subEmpty : copy.subTotal(all.length)}
          </p>
        </div>
        <div className="flex rounded-full border border-[var(--border-hairline)] bg-[var(--surface-sunken)]/60 p-0.5 text-[11px]">
          {(
            [
              { v: "all" as const, label: copy.everyone, count: all.length },
              { v: "mine" as const, label: copy.mine, count: myCount },
            ]
          ).map((s) => (
            <button
              key={s.v}
              type="button"
              onClick={() => setScope(s.v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors",
                scope === s.v
                  ? "bg-[var(--text-primary)] text-[var(--surface-raised)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              {s.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold",
                  scope === s.v ? "bg-[var(--surface-raised)]/20" : "bg-[var(--surface-raised)]"
                )}
              >
                {s.count}
              </span>
            </button>
          ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="flex-1 px-5 py-10 text-center text-sm text-[var(--text-muted)]">
          {scope === "mine" ? copy.noneMine : copy.noneAll}
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-[var(--border-hairline)] overflow-y-auto">
          {filtered.map((row) => {
            const KindIcon = KIND_ICON[row.kind];
            return (
              <li key={row.id} className="px-4 py-3 sm:px-5">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", PRIORITY_DOT[row.priority])}
                    title={`${row.priority} priority`}
                  />
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]"
                  >
                    <KindIcon size={16} />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {KIND_PRIMARY_LABEL[row.kind]}
                      </span>
                      <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {row.itemTypeLabel}
                      </span>
                      {row.deadlineAt && <DeadlinePill iso={row.deadlineAt} copy={copy} />}
                    </div>
                    <button
                      type="button"
                      onClick={() => onItemClick(row.item)}
                      className="block w-full text-left"
                    >
                      <p className="truncate text-sm font-medium text-[var(--text-primary)] hover:underline">
                        {row.title}
                      </p>
                    </button>
                    <p className="truncate text-[11px] text-[var(--text-muted)]">{row.reason}</p>
                    {feedback?.rowId === row.id && (
                      <p
                        className={cn(
                          "text-[11px]",
                          feedback.tone === "ok"
                            ? "text-[var(--status-settled)]"
                            : feedback.tone === "err"
                              ? "text-[var(--status-blocked)]"
                              : "text-[var(--text-muted)]"
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
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={nudgingId === row.id}
                        onClick={() => void handleNudge(row)}
                      >
                        {nudgingId === row.id ? copy.nudging : KIND_PRIMARY_LABEL[row.kind]}
                      </Button>
                    ) : (
                      <button
                        type="button"
                        className="btn-tactile !px-3 !py-1.5 !text-xs"
                        onClick={() => onItemClick(row.item)}
                      >
                        {KIND_PRIMARY_LABEL[row.kind]}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DeadlinePill({
  iso,
  copy,
}: {
  iso: string;
  copy: typeof COPY[keyof typeof COPY];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(iso).getTime() - now;
  const overdue = diff <= 0;
  const hours = Math.abs(diff) / 3_600_000;

  let label: string;
  if (overdue) label = copy.overdue;
  else if (hours < 1) label = copy.minLeft(Math.floor((Math.abs(diff) % 3_600_000) / 60_000));
  else if (hours < 24) label = copy.hLeft(Math.floor(hours));
  else label = copy.dLeft(Math.floor(hours / 24));

  const tone =
    overdue || hours < 2
      ? "bg-[var(--status-blocked-soft)] text-[var(--status-blocked)]"
      : hours < 12
        ? "bg-[var(--status-needs-decision-soft)] text-[var(--status-needs-decision)]"
        : "bg-[var(--surface-sunken)] text-[var(--text-muted)]";

  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", tone)}>
      <IconClock size={10} />
      {label}
    </span>
  );
}

// Backwards-compat alias.
export const TripActionQueue = ActionQueueTile;

"use client";

import Link from "next/link";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { cn } from "@/lib/utils";
import type { BoardData, TripItem } from "@/lib/types";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { WebActiveVote } from "@/app/api/app/trips/[tripId]/votes/route";
import { ITEM_TYPE_LABELS } from "@/components/app/board-columns";
import { IconArrowUpRight, IconChevronRight, IconCheck } from "@/components/app/icons";

const COPY = {
  en: {
    title: "Decision center",
    sub: "What still needs to be decided.",
    needsVote: "Needs vote",
    waitingOwner: "Waiting on owner",
    recentlyConfirmed: "Recently locked in",
    empty: "Nothing waiting on you. Nice.",
    pickOwner: "Tap to assign",
    open: "All votes",
    of: "of",
    voted: "voted",
    waiting: "Waiting",
    plus: (n: number) => `+${n}`,
    more: (n: number) => `+${n} more`,
    locked: "Locked in",
    book: "Book",
    booked: "Booked",
    owner: "Owner",
  },
  "zh-TW": {
    title: "決策中心",
    sub: "還沒決定的事項。",
    needsVote: "需要投票",
    waitingOwner: "等待負責人",
    recentlyConfirmed: "近期已決定",
    empty: "目前沒有待決定的事，做得好。",
    pickOwner: "點擊指派",
    open: "全部投票",
    of: "/",
    voted: "已投",
    waiting: "等待",
    plus: (n: number) => `+${n}`,
    more: (n: number) => `還有 ${n} 個`,
    locked: "已敲定",
    book: "待訂",
    booked: "已訂",
    owner: "負責人",
  },
} as const;

interface TileProps {
  tripId: string;
  board: BoardData;
  members: AppMember[];
  votes: WebActiveVote[];
  onItemClick: (item: TripItem) => void;
}

export function DecisionCenterTile(props: TileProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const { tripId, board, members, votes, onItemClick } = props;
  const memberById = new Map(members.map((m) => [m.lineUserId, m]));

  const needsVote = board.pending;
  const missingOwner = board.todo.filter((i) => i.assigned_to_line_user_id == null);
  const recentlyConfirmed = [...board.confirmed]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 4);

  const totalDecisions = needsVote.length + missingOwner.length + recentlyConfirmed.length;

  return (
    <section className="surface-tile flex h-full flex-col p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-display text-2xl text-[var(--text-primary)]">{copy.title}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{copy.sub}</p>
        </div>
        <Link
          href={`/app/trips/${tripId}/votes`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-line)] hover:underline"
        >
          {copy.open}
          <IconArrowUpRight size={12} />
        </Link>
      </header>

      {totalDecisions === 0 ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 px-4 py-10 text-center">
          <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent-line-soft)] text-[var(--accent-line)]">
            <IconCheck size={18} />
          </span>
          <p className="text-sm text-[var(--text-muted)]">{copy.empty}</p>
        </div>
      ) : (
        <div className="mt-5 grid flex-1 gap-4 lg:grid-cols-3">
          <Group title={copy.needsVote} tone="decision" count={needsVote.length}>
            {needsVote.slice(0, 4).map((item) => {
              const vote = votes.find((v) => v.item.id === item.id);
              const memberCount = vote?.memberCount ?? members.length;
              const totalVotes = vote?.totalVotes ?? 0;
              const nonVoters = computeNonVoters(vote, members);
              return (
                <DecisionRow
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  title={item.title}
                  badge={ITEM_TYPE_LABELS[item.item_type] ?? "Item"}
                  bottom={
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                      <span className="text-mono">
                        {totalVotes}/{memberCount} {copy.voted}
                      </span>
                      {nonVoters.length > 0 && (
                        <span className="truncate">
                          {copy.waiting}:{" "}
                          <span className="font-medium text-[var(--status-needs-decision)]">
                            {nonVoters.slice(0, 2).map((n) => n.displayName ?? "?").join(", ")}
                            {nonVoters.length > 2 && ` ${copy.plus(nonVoters.length - 2)}`}
                          </span>
                        </span>
                      )}
                    </div>
                  }
                  progress={memberCount > 0 ? (totalVotes / memberCount) * 100 : null}
                  progressTone="decision"
                />
              );
            })}
            {needsVote.length > 4 && (
              <p className="text-[11px] text-[var(--text-muted)]">{copy.more(needsVote.length - 4)}</p>
            )}
          </Group>

          <Group title={copy.waitingOwner} tone="muted" count={missingOwner.length}>
            {missingOwner.slice(0, 4).map((item) => (
              <DecisionRow
                key={item.id}
                onClick={() => onItemClick(item)}
                title={item.title}
                badge={ITEM_TYPE_LABELS[item.item_type] ?? "Item"}
                bottom={<p className="text-[11px] text-[var(--text-muted)]">{copy.pickOwner}</p>}
              />
            ))}
            {missingOwner.length > 4 && (
              <p className="text-[11px] text-[var(--text-muted)]">{copy.more(missingOwner.length - 4)}</p>
            )}
          </Group>

          <Group title={copy.recentlyConfirmed} tone="settled" count={board.confirmed.length}>
            {recentlyConfirmed.map((item) => {
              const owner = item.assigned_to_line_user_id
                ? memberById.get(item.assigned_to_line_user_id)
                : null;
              return (
                <DecisionRow
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  title={item.title}
                  badge={
                    item.booking_status === "needed"
                      ? copy.book
                      : item.booking_status === "booked"
                        ? copy.booked
                        : (ITEM_TYPE_LABELS[item.item_type] ?? "Item")
                  }
                  badgeTone={
                    item.booking_status === "needed"
                      ? "decision"
                      : item.booking_status === "booked"
                        ? "settled"
                        : "neutral"
                  }
                  bottom={
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {owner ? `${copy.owner}: ${owner.displayName ?? "?"}` : copy.locked}
                    </p>
                  }
                />
              );
            })}
          </Group>
        </div>
      )}
    </section>
  );
}

function computeNonVoters(vote: WebActiveVote | undefined, members: AppMember[]): AppMember[] {
  if (!vote) return [];
  const voted = new Set<string>();
  for (const opt of vote.options) for (const v of opt.voters) voted.add(v.lineUserId);
  return members.filter((m) => !voted.has(m.lineUserId));
}

type Tone = "decision" | "muted" | "settled" | "neutral";

function Group({
  title,
  tone,
  count,
  children,
}: {
  title: string;
  tone: Tone;
  count: number;
  children: React.ReactNode;
}) {
  const toneText =
    tone === "decision"
      ? "text-[var(--status-needs-decision)]"
      : tone === "settled"
        ? "text-[var(--status-settled)]"
        : "text-[var(--text-muted)]";
  const toneDot =
    tone === "decision"
      ? "bg-[var(--status-needs-decision)]"
      : tone === "settled"
        ? "bg-[var(--status-settled)]"
        : "bg-[var(--text-faint)]";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", toneDot)} aria-hidden />
        <h3 className={cn("text-caps", toneText)}>{title}</h3>
        <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
          {count}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DecisionRow({
  onClick,
  title,
  badge,
  badgeTone = "neutral",
  bottom,
  progress,
  progressTone,
}: {
  onClick: () => void;
  title: string;
  badge: string;
  badgeTone?: Tone;
  bottom?: React.ReactNode;
  progress?: number | null;
  progressTone?: "decision" | "settled";
}) {
  const badgeColors =
    badgeTone === "decision"
      ? "bg-[var(--status-needs-decision-soft)] text-[var(--status-needs-decision)]"
      : badgeTone === "settled"
        ? "bg-[var(--status-settled-soft)] text-[var(--status-settled)]"
        : "bg-[var(--surface-sunken)] text-[var(--text-muted)]";

  const fillTone = progressTone === "settled" ? "bg-[var(--status-settled)]" : "bg-[var(--status-needs-decision)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group block w-full space-y-1.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-3 py-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-[var(--text-primary)]">{title}</span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", badgeColors)}>
          {badge}
        </span>
      </div>
      {bottom}
      {progress != null && (
        <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div
            className={cn("h-full transition-[width] duration-500", fillTone)}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
      <span className="absolute opacity-0 group-focus-visible:static group-focus-visible:opacity-100">
        <IconChevronRight size={12} />
      </span>
    </button>
  );
}

// Backwards-compat alias for any stragglers.
export const TripDecisionCenter = DecisionCenterTile;

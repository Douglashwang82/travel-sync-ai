"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import {
  TabPageHeader,
  TabSurface,
  TabSurfaceTitle,
  TabError,
  TabSkeleton,
  TabEmptyState,
} from "@/components/app/tab-shell";
import { PlacePicker, type PickedPlace } from "@/components/app/place-picker";
import type { BoardData } from "@/lib/types";
import type {
  WebActiveVote,
  WebVotesResponse,
} from "@/app/api/app/trips/[tripId]/votes/route";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { NudgeResponse } from "@/app/api/app/trips/[tripId]/votes/[itemId]/nudge/route";
import { OptionDetailDialog } from "@/components/app/option-detail-dialog";

const TYPE_LABEL: Record<string, string> = {
  hotel: "住宿",
  restaurant: "餐廳",
  activity: "活動",
  transport: "交通",
  flight: "航班",
  insurance: "保險",
  other: "其他",
};

type OverviewState = {
  votes: WebActiveVote[];
  memberCount: number;
  members: AppMember[];
  todo: BoardData["todo"];
  role: "organizer" | "member";
  currentUserId: string;
};

export function TripVotesClient({ tripId }: { tripId: string }) {
  const [state, setState] = useState<OverviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [casting, setCasting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [startItemId, setStartItemId] = useState<string | null>(null);
  const [closeItem, setCloseItem] = useState<WebActiveVote | null>(null);

  const load = useCallback(async () => {
    try {
      const [votes, board, trip, members] = await Promise.all([
        appFetchJson<WebVotesResponse>(`/api/app/trips/${tripId}/votes`),
        appFetchJson<BoardData>(`/api/app/trips/${tripId}/board`),
        appFetchJson<{ role: "organizer" | "member" }>(`/api/app/trips/${tripId}`),
        appFetchJson<{ members: AppMember[] }>(`/api/app/trips/${tripId}/members`),
      ]);
      setError(null);
      setState({
        votes: votes.votes,
        memberCount: votes.memberCount,
        members: members.members,
        todo: board.todo,
        role: trip.role,
        currentUserId: board.currentUser.lineUserId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "投票載入失敗");
    }
  }, [tripId]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function handleCast(itemId: string, optionId: string) {
    setCasting(`${itemId}:${optionId}`);
    setActionError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/votes`, {
        method: "POST",
        body: JSON.stringify({ tripItemId: itemId, optionId }),
      });
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "投票失敗");
    } finally {
      setCasting(null);
    }
  }

  if (error) {
    return <TabError message={error} onRetry={() => void load()} />;
  }

  if (!state) {
    return <TabSkeleton />;
  }

  const { votes, memberCount, members, todo, role, currentUserId } = state;
  const isOrganizer = role === "organizer";
  const votableTodo = todo.filter((item) => item.item_kind === "decision");

  return (
    <div className="space-y-6">
      <TabPageHeader
        id="votes-page-header"
        title="投票"
        subtitle={`目前的群組決策。${memberCount} 人中達 ${majorityThreshold(memberCount)} 票多數即自動確認勝出選項。`}
      />

      {actionError && (
        <div className="rounded-xl border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
          {actionError}
        </div>
      )}

      {votes.length === 0 ? (
        <TabEmptyState
          message={
            isOrganizer
              ? "目前沒有進行中的投票。可從下方待辦清單開始一個投票。"
              : "目前沒有進行中的投票。請主揪開始投票。"
          }
        />
      ) : (
        <div className="space-y-5">
          {votes.map((v) => (
            <VoteCard
              key={v.item.id}
              vote={v}
              memberCount={memberCount}
              members={members}
              currentUserId={currentUserId}
              isOrganizer={isOrganizer}
              casting={casting}
              onCast={(optionId) => void handleCast(v.item.id, optionId)}
              onCloseClick={() => setCloseItem(v)}
              onAddOption={() => void load()}
              tripId={tripId}
            />
          ))}
        </div>
      )}

      {isOrganizer && (
        <TabSurface>
          <TabSurfaceTitle
            id="votes-new-header"
            title="開始新投票"
            subtitle="將待辦項目轉成群組決策，加入至少 2 個選項與截止時間。"
            trailing={
              <span className="text-mono text-[11px] text-[var(--text-muted)]">
                {votableTodo.length} 個可投票項目
              </span>
            }
          />
          {votableTodo.length === 0 ? (
            <p className="mt-4 text-xs italic text-[var(--text-muted)]">
              目前沒有可投票的群組決策。請先從總覽新增一個群組決策。
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border-hairline)]">
              {votableTodo.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {TYPE_LABEL[item.item_type] ?? "項目"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStartItemId(item.id)}
                  >
                    開始投票
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabSurface>
      )}

      {startItemId && (
        <StartVoteDialog
          tripId={tripId}
          itemId={startItemId}
          itemTitle={
            votableTodo.find((t) => t.id === startItemId)?.title ?? "這個項目"
          }
          onClose={() => setStartItemId(null)}
          onStarted={() => {
            setStartItemId(null);
            void load();
          }}
        />
      )}

      {closeItem && (
        <CloseVoteDialog
          tripId={tripId}
          vote={closeItem}
          onClose={() => setCloseItem(null)}
          onClosed={() => {
            setCloseItem(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function majorityThreshold(memberCount: number): number {
  if (memberCount <= 0) return 0;
  return Math.floor(memberCount / 2) + 1;
}

function VoteCard({
  vote,
  memberCount,
  members,
  currentUserId,
  isOrganizer,
  casting,
  onCast,
  onCloseClick,
  onAddOption,
  tripId,
}: {
  vote: WebActiveVote;
  memberCount: number;
  members: AppMember[];
  currentUserId: string;
  isOrganizer: boolean;
  casting: string | null;
  onCast: (optionId: string) => void;
  onCloseClick: () => void;
  onAddOption: () => void;
  tripId: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [detailOptionId, setDetailOptionId] = useState<string | null>(null);
  const detailOption = detailOptionId
    ? vote.options.find((o) => o.id === detailOptionId) ?? null
    : null;
  const needed = majorityThreshold(memberCount);
  const myVote = vote.options.find((o) => o.votedByMe);
  // Default to collapsed if I've already voted — keeps unresolved votes in focus.
  const [collapsed, setCollapsed] = useState<boolean>(() => !!myVote);
  const iHaventVoted = !myVote && members.some((m) => m.lineUserId === currentUserId);

  const nonVoters = useMemo(() => {
    const voted = new Set<string>();
    for (const opt of vote.options) for (const v of opt.voters) voted.add(v.lineUserId);
    return members.filter((m) => !voted.has(m.lineUserId));
  }, [members, vote.options]);

  return (
    <article
      className={cn(
        "surface-tile overflow-hidden transition-shadow",
        !collapsed && "shadow-[var(--shadow-raise)]"
      )}
    >
      <header
        className={cn(
          "space-y-3 p-5",
          !collapsed && "border-b border-[var(--border-hairline)]"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-controls={`vote-body-${vote.item.id}`}
            className="-m-1 flex min-w-0 flex-1 items-start gap-2 rounded-lg p-1 text-left transition-colors hover:bg-[var(--secondary)]/40"
          >
            <span
              aria-hidden
              className={cn(
                "mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-transform",
                collapsed ? "rotate-0" : "rotate-90"
              )}
            >
              ▶
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {TYPE_LABEL[vote.item.itemType] ?? "投票"}
                </Badge>
                <Badge className="border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  投票中
                </Badge>
                {iHaventVoted && (
                  <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                    等你投票
                  </span>
                )}
                {vote.item.deadlineAt && (
                  <DeadlineCountdown deadlineAt={vote.item.deadlineAt} />
                )}
              </div>
              <h3 className="mt-1.5 text-base font-semibold">{vote.item.title}</h3>
              {vote.item.description && !collapsed && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {vote.item.description}
                </p>
              )}
              {collapsed && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {vote.options.length} 個選項 · 已投 {vote.totalVotes}/{memberCount}
                  {myVote && (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                      已選 {myVote.name}
                    </span>
                  )}
                </p>
              )}
            </div>
          </button>
          {isOrganizer && !collapsed && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                新增選項
              </Button>
              <Button size="sm" variant="outline" onClick={onCloseClick}>
                結束投票
              </Button>
            </div>
          )}
        </div>

        {!collapsed && (
          <VoteProgress
            totalVotes={vote.totalVotes}
            memberCount={memberCount}
            needed={needed}
          />
        )}

        {!collapsed && (
          <NonVoterRow
            tripId={tripId}
            itemId={vote.item.id}
            nonVoters={nonVoters}
            currentUserId={currentUserId}
          />
        )}
      </header>

      <ul
        id={`vote-body-${vote.item.id}`}
        hidden={collapsed}
        className="divide-y divide-[var(--border-hairline)]"
      >
        {vote.options.map((opt) => {
          const castingThis = casting === `${vote.item.id}:${opt.id}`;
          const share = memberCount > 0 ? (opt.voteCount / memberCount) * 100 : 0;
          const hasDetail =
            !!opt.address ||
            !!opt.notes ||
            !!opt.priceLevel ||
            opt.rating != null;
          return (
            <li key={opt.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setDetailOptionId(opt.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDetailOptionId(opt.id);
                  }
                }}
                className={cn(
                  "group relative w-full cursor-pointer text-left transition-colors",
                  opt.votedByMe
                    ? "bg-[var(--primary)]/5"
                    : "hover:bg-[var(--secondary)]/50"
                )}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--primary)]/10 transition-all"
                  style={{ width: `${Math.min(100, share)}%` }}
                  aria-hidden
                />
                <div className="relative flex items-start gap-3 p-4">
                  {opt.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={opt.imageUrl}
                      alt={opt.name}
                      className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{opt.name}</span>
                      {opt.votedByMe && (
                        <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-semibold text-white">
                          你的選擇
                        </span>
                      )}
                      {opt.rating != null && (
                        <span className="text-xs text-[var(--text-muted)]">
                          ★ {opt.rating}
                        </span>
                      )}
                      {opt.priceLevel && (
                        <span className="text-xs text-[var(--text-muted)]">
                          {opt.priceLevel}
                        </span>
                      )}
                      {opt.notes && (
                        <span
                          className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                          title="有群組備註"
                        >
                          備註
                        </span>
                      )}
                    </div>
                    {opt.address && (
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        📍 {opt.address}
                      </p>
                    )}
                    {opt.voters.length > 0 && (
                      <VoterAvatars voters={opt.voters} />
                    )}
                    <p className="text-[11px] text-[var(--primary)] opacity-70 group-hover:opacity-100">
                      {hasDetail ? "點一下看詳情" : "點一下新增價格、地點或備註"}
                    </p>
                  </div>
                  <div
                    className="flex shrink-0 flex-col items-stretch gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex flex-col items-end">
                      <span className="text-xl font-bold tabular-nums leading-none">
                        {opt.voteCount}
                      </span>
                      <span className="text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
                        票
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant={opt.votedByMe ? "default" : "outline"}
                      onClick={() => onCast(opt.id)}
                      disabled={casting !== null}
                      className={cn(
                        "h-7 px-2.5 text-[11px]",
                        opt.votedByMe &&
                          "bg-emerald-600 text-white hover:bg-emerald-700"
                      )}
                    >
                      {castingThis
                        ? "儲存中..."
                        : opt.votedByMe
                          ? "已投票"
                          : "投票"}
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {addOpen && (
        <AddOptionDialog
          tripId={tripId}
          itemId={vote.item.id}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            onAddOption();
          }}
        />
      )}

      <OptionDetailDialog
        tripId={tripId}
        vote={vote}
        option={detailOption}
        onClose={() => setDetailOptionId(null)}
        onVote={(optionId) => onCast(optionId)}
        onUpdated={() => {
          onAddOption();
        }}
      />
    </article>
  );
}

const AVATAR_PALETTES = [
  "bg-rose-200 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  "bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  "bg-sky-200 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  "bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  "bg-fuchsia-200 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200",
  "bg-orange-200 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  "bg-cyan-200 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
];

function avatarPalette(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[idx];
}

function avatarInitial(name: string | null, fallback: string): string {
  const source = name?.trim() || fallback;
  return source.slice(0, 1).toUpperCase();
}

function VoterAvatars({
  voters,
}: {
  voters: Array<{ lineUserId: string; displayName: string | null }>;
}) {
  const visible = voters.slice(0, 5);
  const overflow = voters.length - visible.length;
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1.5">
        {visible.map((v) => {
          const label = v.displayName ?? v.lineUserId.slice(0, 6);
          return (
            <span
              key={v.lineUserId}
              title={`${label} 已投票`}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-[var(--background)]",
                avatarPalette(v.lineUserId)
              )}
              aria-label={`${label} 已投票`}
            >
              {avatarInitial(v.displayName, v.lineUserId)}
            </span>
          );
        })}
        {overflow > 0 && (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--secondary)] text-[10px] font-semibold text-[var(--text-muted)] ring-2 ring-[var(--background)]"
            title={voters
              .slice(5)
              .map((v) => v.displayName ?? v.lineUserId.slice(0, 6))
              .join(", ")}
          >
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-[11px] text-[var(--text-muted)]">
        {voters.length === 1
          ? voters[0].displayName ?? voters[0].lineUserId.slice(0, 6)
          : `${voters.length} 人已投`}
      </span>
    </div>
  );
}

function DeadlineCountdown({ deadlineAt }: { deadlineAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const diffMs = new Date(deadlineAt).getTime() - now;
  const overdue = diffMs <= 0;
  const hours = Math.floor(Math.abs(diffMs) / 3_600_000);
  const minutes = Math.floor((Math.abs(diffMs) % 3_600_000) / 60_000);

  let label: string;
  if (overdue) {
    label = "已逾期";
  } else if (hours < 1) {
    label = `剩 ${minutes} 分`;
  } else if (hours < 24) {
    label = `剩 ${hours} 小時 ${minutes} 分`;
  } else {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    label = `剩 ${days} 天 ${remHours} 小時`;
  }

  const tone = overdue
    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
    : hours < 2
      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      : hours < 12
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-[var(--secondary)] text-[var(--text-muted)]";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        tone
      )}
      title={new Date(deadlineAt).toLocaleString()}
    >
      <span aria-hidden>⏱</span>
      {label}
    </span>
  );
}

function VoteProgress({
  totalVotes,
  memberCount,
  needed,
}: {
  totalVotes: number;
  memberCount: number;
  needed: number;
}) {
  if (memberCount <= 0) return null;
  const pct = Math.min(100, (totalVotes / memberCount) * 100);
  const majorityPct = Math.min(100, (needed / memberCount) * 100);
  const reached = totalVotes >= needed;
  return (
    <div className="space-y-1">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--secondary)]">
        <div
          className={cn(
            "h-full transition-all",
            reached ? "bg-emerald-500" : "bg-[var(--primary)]"
          )}
          style={{ width: `${pct}%` }}
        />
        <div
          aria-hidden
          className="absolute top-0 h-full w-px bg-[var(--foreground)]/40"
          style={{ left: `${majorityPct}%` }}
          title="多數門檻"
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>
          <span className="font-semibold text-[var(--foreground)]">
            {totalVotes}
          </span>
          <span> / {memberCount} 已投</span>
        </span>
        <span>
          {reached
            ? "已達多數"
            : `還差 ${needed - totalVotes} 票達多數`}
        </span>
      </div>
    </div>
  );
}

interface NudgeFeedback {
  message: string;
  tone: "success" | "info" | "error";
}

function NonVoterRow({
  tripId,
  itemId,
  nonVoters,
  currentUserId,
}: {
  tripId: string;
  itemId: string;
  nonVoters: AppMember[];
  currentUserId: string;
}) {
  const [nudging, setNudging] = useState<string | "all" | null>(null);
  const [feedback, setFeedback] = useState<NudgeFeedback | null>(null);

  if (nonVoters.length === 0) {
    return (
      <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        所有人都已投票
      </p>
    );
  }

  const others = nonVoters.filter((m) => m.lineUserId !== currentUserId);
  const includesMe = nonVoters.some((m) => m.lineUserId === currentUserId);

  async function nudge(targetIds: string[] | undefined, key: string | "all") {
    if (nudging) return;
    setNudging(key);
    setFeedback(null);
    try {
      const res = await appFetchJson<NudgeResponse>(
        `/api/app/trips/${tripId}/votes/${itemId}/nudge`,
        {
          method: "POST",
          body: JSON.stringify(targetIds ? { lineUserIds: targetIds } : {}),
        }
      );
      const nudgedCount = res.nudged.length;
      const cooldownCount = res.skipped.filter(
        (s) => s.reason === "cooldown"
      ).length;
      if (nudgedCount === 0 && cooldownCount > 0) {
        setFeedback({
          message: "30 分鐘內已提醒過，請稍後再試。",
          tone: "info",
        });
      } else if (nudgedCount === 0) {
        setFeedback({
          message: "目前沒有可提醒的人。",
          tone: "info",
        });
      } else {
        const names = res.nudged
          .map((n) => n.displayName ?? "?")
          .slice(0, 3)
          .join(", ");
        const more = res.nudged.length > 3 ? ` +${res.nudged.length - 3} 人` : "";
        setFeedback({
          message:
            cooldownCount > 0
              ? `已提醒 ${names}${more} · ${cooldownCount} 人冷卻中`
              : `已提醒 ${names}${more}`,
          tone: "success",
        });
      }
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : "提醒失敗",
        tone: "error",
      });
    } finally {
      setNudging(null);
    }
  }

  const otherIds = others.map((m) => m.lineUserId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          等待投票
        </span>
        <div className="flex flex-wrap gap-1.5">
          {includesMe && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
              你
            </span>
          )}
          {others.map((m) => (
            <button
              key={m.lineUserId}
              type="button"
              onClick={() => void nudge([m.lineUserId], m.lineUserId)}
              disabled={nudging !== null}
              className={cn(
                "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-200 disabled:opacity-60 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60",
                nudging === m.lineUserId && "animate-pulse"
              )}
              title={`透過 LINE 提醒 ${m.displayName ?? "這位成員"}`}
            >
              <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-200 text-[8px] font-bold dark:bg-amber-900">
                {(m.displayName ?? "?").slice(0, 1).toUpperCase()}
              </span>
              {m.displayName ?? m.lineUserId.slice(0, 6)}
              {nudging === m.lineUserId ? (
                <span className="text-[10px]">…</span>
              ) : (
                <span aria-hidden className="text-[10px] opacity-70">
                  🔔
                </span>
              )}
            </button>
          ))}
        </div>
        {others.length > 1 && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            disabled={nudging !== null}
            onClick={() => void nudge(otherIds, "all")}
          >
            {nudging === "all" ? "提醒中..." : "提醒全部"}
          </Button>
        )}
      </div>
      {feedback && (
        <p
          className={cn(
            "text-[11px]",
            feedback.tone === "success"
              ? "text-emerald-700 dark:text-emerald-300"
              : feedback.tone === "error"
                ? "text-red-700 dark:text-red-300"
                : "text-[var(--text-muted)]"
          )}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

function defaultDeadlineLocal(): string {
  const d = new Date();
  d.setHours(d.getHours() + 24);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StartVoteDialog({
  tripId,
  itemId,
  itemTitle,
  onClose,
  onStarted,
}: {
  tripId: string;
  itemId: string;
  itemTitle: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [deadline, setDeadline] = useState(defaultDeadlineLocal());
  const [options, setOptions] = useState<
    Array<{ name: string; address: string; imageUrl: string; bookingUrl: string }>
  >([
    { name: "", address: "", imageUrl: "", bookingUrl: "" },
    { name: "", address: "", imageUrl: "", bookingUrl: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateOption(
    idx: number,
    patch: Partial<(typeof options)[number]>
  ) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  function addRow() {
    if (options.length >= 10) return;
    setOptions((prev) => [...prev, { name: "", address: "", imageUrl: "", bookingUrl: "" }]);
  }

  function removeRow(idx: number) {
    if (options.length <= 2) return;
    setOptions((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleStart() {
    setError(null);
    const payloadOptions = options
      .map((o) => ({
        name: o.name.trim(),
        address: o.address.trim() || undefined,
        imageUrl: o.imageUrl.trim() || undefined,
        bookingUrl: o.bookingUrl.trim() || undefined,
      }))
      .filter((o) => o.name.length > 0);

    if (payloadOptions.length < 2) {
      setError("請至少輸入兩個選項。");
      return;
    }
    if (!deadline) {
      setError("請選擇投票截止時間。");
      return;
    }
    const iso = new Date(deadline).toISOString();
    if (Number.isNaN(new Date(deadline).getTime())) {
      setError("截止時間無效。");
      return;
    }

    setSubmitting(true);
    try {
      await appFetchJson(
        `/api/app/trips/${tripId}/items/${itemId}/start-vote`,
        {
          method: "POST",
          body: JSON.stringify({ deadlineAt: iso, options: payloadOptions }),
        }
      );
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "開始投票失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>開始投票：{itemTitle}</DialogTitle>
          <DialogDescription>
            加入讓大家選擇的選項，然後設定截止時間。達多數會自動確認；主揪也可以提前結束。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="start-deadline">截止時間</Label>
            <Input
              id="start-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>選項</Label>
              <button
                type="button"
                onClick={addRow}
                disabled={options.length >= 10}
                className="text-xs font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
              >
                + 新增選項
              </button>
            </div>

            <div className="space-y-3">
              {options.map((o, idx) => (
                <div
                  key={idx}
                  className="space-y-2 rounded-xl border border-[var(--border-hairline)] bg-[var(--secondary)]/40 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      選項 {idx + 1}
                    </span>
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="text-[11px] text-[var(--text-muted)] hover:text-destructive"
                      >
                        移除
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="名稱（必填），例如：Hotel Granvia"
                    value={o.name}
                    onChange={(e) => updateOption(idx, { name: e.target.value })}
                  />
                  <Input
                    placeholder="地址（選填）"
                    value={o.address}
                    onChange={(e) => updateOption(idx, { address: e.target.value })}
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="圖片 URL（選填）"
                      value={o.imageUrl}
                      onChange={(e) => updateOption(idx, { imageUrl: e.target.value })}
                    />
                    <Input
                      placeholder="預訂 URL（選填）"
                      value={o.bookingUrl}
                      onChange={(e) =>
                        updateOption(idx, { bookingUrl: e.target.value })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              取消
            </Button>
          </DialogClose>
          <Button onClick={() => void handleStart()} disabled={submitting}>
            {submitting ? "開始中..." : "開始投票"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseVoteDialog({
  tripId,
  vote,
  onClose,
  onClosed,
}: {
  tripId: string;
  vote: WebActiveVote;
  onClose: () => void;
  onClosed: () => void;
}) {
  const leader =
    vote.options.length > 0
      ? [...vote.options].sort((a, b) => b.voteCount - a.voteCount)[0]
      : null;
  const [winnerId, setWinnerId] = useState<string | undefined>(
    leader?.id ?? undefined
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClose() {
    if (!winnerId) {
      setError("請選擇勝出選項。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await appFetchJson(
        `/api/app/trips/${tripId}/items/${vote.item.id}/close-vote`,
        {
          method: "POST",
          body: JSON.stringify({ winningOptionId: winnerId }),
        }
      );
      onClosed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "結束投票失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>結束投票：{vote.item.title}</DialogTitle>
          <DialogDescription>
            選擇勝出選項。此項目會被確認；若需要預訂，會進入預訂佇列。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label>勝出選項</Label>
          <Select value={winnerId} onValueChange={setWinnerId}>
            <SelectTrigger>
              <SelectValue placeholder="選擇一個選項" />
            </SelectTrigger>
            <SelectContent>
              {vote.options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}（{o.voteCount} 票）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              取消
            </Button>
          </DialogClose>
          <Button onClick={() => void handleClose()} disabled={submitting || !winnerId}>
            {submitting ? "結束中..." : "確認勝出"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddOptionDialog({
  tripId,
  itemId,
  onClose,
  onAdded,
}: {
  tripId: string;
  itemId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [address, setAddress] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePlacePicked(p: PickedPlace | null) {
    setPlace(p);
    if (p) {
      // Auto-fill name + address from the picked place when empty.
      if (!name.trim()) setName(p.name);
      if (!address.trim() && p.address) setAddress(p.address);
    }
  }

  async function handleAdd() {
    if (!name.trim()) {
      setError("選項需要名稱。");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/items/${itemId}/options`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          address: address.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
          bookingUrl: bookingUrl.trim() || undefined,
          lat: place?.lat ?? undefined,
          lng: place?.lng ?? undefined,
          googleMapsUrl: place?.googleMapsUrl ?? undefined,
        }),
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增選項失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新增選項</DialogTitle>
          <DialogDescription>
            為目前投票加入另一個選擇。既有投票不會受到影響。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="opt-name">名稱</Label>
            <Input
              id="opt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opt-place">選擇地點（選填）</Label>
            <PlacePicker
              inputId="opt-place"
              value={place}
              onChange={handlePlacePicked}
              placeholder="搜尋 Google 地點，加入地圖"
            />
            <p className="text-[11px] text-muted-foreground">
              選擇地點後會附上座標，這個選項就會顯示在旅程地圖上。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opt-address">地址（選填）</Label>
            <Input
              id="opt-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opt-image">圖片 URL（選填）</Label>
              <Input
                id="opt-image"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opt-book">預訂 URL（選填）</Label>
              <Input
                id="opt-book"
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              取消
            </Button>
          </DialogClose>
          <Button onClick={() => void handleAdd()} disabled={submitting}>
            {submitting ? "新增中..." : "新增選項"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

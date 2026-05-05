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
import type { BoardData } from "@/lib/types";
import type {
  WebActiveVote,
  WebVotesResponse,
} from "@/app/api/app/trips/[tripId]/votes/route";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { NudgeResponse } from "@/app/api/app/trips/[tripId]/votes/[itemId]/nudge/route";

const TYPE_LABEL: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "Restaurant",
  activity: "Activity",
  transport: "Transport",
  flight: "Flight",
  insurance: "Insurance",
  other: "Other",
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
      setError(err instanceof Error ? err.message : "Failed to load votes");
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
      setActionError(err instanceof Error ? err.message : "Failed to cast vote");
    } finally {
      setCasting(null);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {error}{" "}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-2 underline underline-offset-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!state) {
    return <div className="h-64 animate-pulse rounded-2xl bg-[var(--secondary)]" />;
  }

  const { votes, memberCount, members, todo, role, currentUserId } = state;
  const isOrganizer = role === "organizer";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Votes</h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            Active group decisions. Majority of {majorityThreshold(memberCount)} of{" "}
            {memberCount} auto-confirms a winner.
          </p>
        </div>
      </div>

      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </div>
      )}

      {votes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] px-6 py-10 text-center text-sm text-[var(--muted-foreground)]">
          No active votes. {isOrganizer
            ? "Start one from the To-Do list below."
            : "Ask your organizer to start one."}
        </div>
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
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Start a new vote</h3>
              <p className="text-xs text-[var(--muted-foreground)]">
                Promote a To-Do item to a group decision with 2+ options and a deadline.
              </p>
            </div>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {todo.length} to-do item{todo.length === 1 ? "" : "s"}
            </span>
          </div>
          {todo.length === 0 ? (
            <p className="mt-4 text-xs italic text-[var(--muted-foreground)]">
              No to-do items available. Add one from the overview first.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)]">
              {todo.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      {TYPE_LABEL[item.item_type] ?? "Item"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStartItemId(item.id)}
                  >
                    Start vote
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {startItemId && (
        <StartVoteDialog
          tripId={tripId}
          itemId={startItemId}
          itemTitle={todo.find((t) => t.id === startItemId)?.title ?? "this item"}
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
  const needed = majorityThreshold(memberCount);
  const myVote = vote.options.find((o) => o.votedByMe);
  const iHaventVoted = !myVote && members.some((m) => m.lineUserId === currentUserId);

  const nonVoters = useMemo(() => {
    const voted = new Set<string>();
    for (const opt of vote.options) for (const v of opt.voters) voted.add(v.lineUserId);
    return members.filter((m) => !voted.has(m.lineUserId));
  }, [members, vote.options]);

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)]">
      <header className="space-y-3 border-b border-[var(--border)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-[10px] uppercase">
                {TYPE_LABEL[vote.item.itemType] ?? "Vote"}
              </Badge>
              <Badge className="border-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                Pending vote
              </Badge>
              {iHaventVoted && (
                <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                  Your vote needed
                </span>
              )}
              {vote.item.deadlineAt && (
                <DeadlineCountdown deadlineAt={vote.item.deadlineAt} />
              )}
            </div>
            <h3 className="mt-1.5 text-base font-semibold">{vote.item.title}</h3>
            {vote.item.description && (
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                {vote.item.description}
              </p>
            )}
          </div>
          {isOrganizer && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                Add option
              </Button>
              <Button size="sm" variant="outline" onClick={onCloseClick}>
                Close vote
              </Button>
            </div>
          )}
        </div>

        <VoteProgress
          totalVotes={vote.totalVotes}
          memberCount={memberCount}
          needed={needed}
        />

        <NonVoterRow
          tripId={tripId}
          itemId={vote.item.id}
          nonVoters={nonVoters}
          currentUserId={currentUserId}
        />
      </header>

      <ul className="divide-y divide-[var(--border)]">
        {vote.options.map((opt) => {
          const castingThis = casting === `${vote.item.id}:${opt.id}`;
          const share = memberCount > 0 ? (opt.voteCount / memberCount) * 100 : 0;
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => onCast(opt.id)}
                disabled={casting !== null}
                className={cn(
                  "group relative w-full text-left transition-colors",
                  opt.votedByMe
                    ? "bg-[var(--primary)]/5"
                    : "hover:bg-[var(--secondary)]/50",
                  casting !== null && "opacity-60"
                )}
              >
                <div className="absolute inset-y-0 left-0 bg-[var(--primary)]/10 transition-all" style={{ width: `${Math.min(100, share)}%` }} aria-hidden />
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
                          Your pick
                        </span>
                      )}
                      {opt.rating != null && (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          ★ {opt.rating}
                        </span>
                      )}
                      {opt.priceLevel && (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {opt.priceLevel}
                        </span>
                      )}
                    </div>
                    {opt.address && (
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        📍 {opt.address}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {opt.googleMapsUrl && (
                        <a
                          href={opt.googleMapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-[var(--primary)] underline-offset-2 hover:underline"
                        >
                          Map
                        </a>
                      )}
                      {opt.bookingUrl && (
                        <a
                          href={opt.bookingUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-[var(--primary)] underline-offset-2 hover:underline"
                        >
                          Book
                        </a>
                      )}
                    </div>
                    {opt.voters.length > 0 && (
                      <VoterAvatars voters={opt.voters} />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xl font-bold tabular-nums">
                      {opt.voteCount}
                    </span>
                    <span className="text-[10px] text-[var(--muted-foreground)]">
                      {castingThis ? "Saving..." : opt.votedByMe ? "Tap again to change" : "Tap to vote"}
                    </span>
                  </div>
                </div>
              </button>
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
              title={`${label} voted`}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-[var(--background)]",
                avatarPalette(v.lineUserId)
              )}
              aria-label={`${label} voted`}
            >
              {avatarInitial(v.displayName, v.lineUserId)}
            </span>
          );
        })}
        {overflow > 0 && (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--secondary)] text-[10px] font-semibold text-[var(--muted-foreground)] ring-2 ring-[var(--background)]"
            title={voters
              .slice(5)
              .map((v) => v.displayName ?? v.lineUserId.slice(0, 6))
              .join(", ")}
          >
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-[11px] text-[var(--muted-foreground)]">
        {voters.length === 1
          ? voters[0].displayName ?? voters[0].lineUserId.slice(0, 6)
          : `${voters.length} voted`}
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
    label = "Overdue";
  } else if (hours < 1) {
    label = `${minutes}m left`;
  } else if (hours < 24) {
    label = `${hours}h ${minutes}m left`;
  } else {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    label = `${days}d ${remHours}h left`;
  }

  const tone = overdue
    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
    : hours < 2
      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      : hours < 12
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-[var(--secondary)] text-[var(--muted-foreground)]";

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
          title="Majority threshold"
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
        <span>
          <span className="font-semibold text-[var(--foreground)]">
            {totalVotes}
          </span>
          <span> of {memberCount} voted</span>
        </span>
        <span>
          {reached
            ? "Majority reached"
            : `${needed - totalVotes} more for majority`}
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
        Everyone has voted ✓
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
          message: `Already nudged in the last 30 min — try again later.`,
          tone: "info",
        });
      } else if (nudgedCount === 0) {
        setFeedback({
          message: "No one to nudge right now.",
          tone: "info",
        });
      } else {
        const names = res.nudged
          .map((n) => n.displayName ?? "?")
          .slice(0, 3)
          .join(", ");
        const more = res.nudged.length > 3 ? ` +${res.nudged.length - 3} more` : "";
        setFeedback({
          message:
            cooldownCount > 0
              ? `Nudged ${names}${more} · ${cooldownCount} on cooldown`
              : `Nudged ${names}${more}`,
          tone: "success",
        });
      }
    } catch (err) {
      setFeedback({
        message: err instanceof Error ? err.message : "Failed to nudge",
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
          Waiting on
        </span>
        <div className="flex flex-wrap gap-1.5">
          {includesMe && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
              You
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
              title={`Nudge ${m.displayName ?? "this member"} via LINE`}
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
            {nudging === "all" ? "Nudging…" : "Nudge all"}
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
                : "text-[var(--muted-foreground)]"
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
      setError("Enter at least two options.");
      return;
    }
    if (!deadline) {
      setError("Pick a deadline for the vote.");
      return;
    }
    const iso = new Date(deadline).toISOString();
    if (Number.isNaN(new Date(deadline).getTime())) {
      setError("Deadline is invalid.");
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
      setError(err instanceof Error ? err.message : "Failed to start vote");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Start vote: {itemTitle}</DialogTitle>
          <DialogDescription>
            Add the options the group should choose between, then set a deadline.
            Majority auto-confirms; organizers can also close early.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="start-deadline">Deadline</Label>
            <Input
              id="start-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Options</Label>
              <button
                type="button"
                onClick={addRow}
                disabled={options.length >= 10}
                className="text-xs font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
              >
                + Add option
              </button>
            </div>

            <div className="space-y-3">
              {options.map((o, idx) => (
                <div
                  key={idx}
                  className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/40 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                      Option {idx + 1}
                    </span>
                    {options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeRow(idx)}
                        className="text-[11px] text-[var(--muted-foreground)] hover:text-destructive"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="Name (required) — e.g. Hotel Granvia"
                    value={o.name}
                    onChange={(e) => updateOption(idx, { name: e.target.value })}
                  />
                  <Input
                    placeholder="Address (optional)"
                    value={o.address}
                    onChange={(e) => updateOption(idx, { address: e.target.value })}
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Image URL (optional)"
                      value={o.imageUrl}
                      onChange={(e) => updateOption(idx, { imageUrl: e.target.value })}
                    />
                    <Input
                      placeholder="Booking URL (optional)"
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
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void handleStart()} disabled={submitting}>
            {submitting ? "Starting..." : "Start vote"}
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
      setError("Pick the winning option.");
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
      setError(err instanceof Error ? err.message : "Failed to close vote");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close vote: {vote.item.title}</DialogTitle>
          <DialogDescription>
            Pick the winning option. The item will be confirmed and, if bookable,
            will enter the booking queue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label>Winning option</Label>
          <Select value={winnerId} onValueChange={setWinnerId}>
            <SelectTrigger>
              <SelectValue placeholder="Pick an option" />
            </SelectTrigger>
            <SelectContent>
              {vote.options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name} ({o.voteCount} vote{o.voteCount === 1 ? "" : "s"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void handleClose()} disabled={submitting || !winnerId}>
            {submitting ? "Closing..." : "Confirm winner"}
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
  const [address, setAddress] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!name.trim()) {
      setError("Option needs a name.");
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
        }),
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add option");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add option</DialogTitle>
          <DialogDescription>
            Adds another choice to this active vote. Existing votes are unaffected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="opt-name">Name</Label>
            <Input
              id="opt-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opt-address">Address (optional)</Label>
            <Input
              id="opt-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="opt-image">Image URL (optional)</Label>
              <Input
                id="opt-image"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opt-book">Booking URL (optional)</Label>
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
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => void handleAdd()} disabled={submitting}>
            {submitting ? "Adding..." : "Add option"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

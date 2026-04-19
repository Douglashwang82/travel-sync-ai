"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LoadingSpinner,
  ListSkeleton,
  ErrorScreen,
  EmptyState,
} from "@/components/liff/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { liffFetch } from "@/lib/liff-client";
import { toLiffErrorMessage } from "@/lib/liff-errors";
import { useLiffSession } from "@/lib/use-liff-session";
import type { ActiveVote, VoteOption } from "@/app/api/liff/votes/route";

export default function VotesPage() {
  const {
    isReady,
    isLoggedIn,
    error,
    session,
    sessionLoading,
    sessionError,
    reloadSession,
  } = useLiffSession();
  const [votes, setVotes] = useState<ActiveVote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [castingFor, setCastingFor] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const sessionData = await reloadSession();
      if (!sessionData) throw new Error("Failed to load session");

      if (!sessionData.activeTrip) {
        setVotes([]);
        return;
      }

      const res = await liffFetch(`/api/liff/votes?tripId=${sessionData.activeTrip.id}`);
      if (!res.ok) throw new Error("Failed to load votes");

      const data = await res.json();
      setVotes(data.votes ?? []);
    } catch (err) {
      setLoadError(
        toLiffErrorMessage(
          "votes",
          err,
          "We could not load active votes right now. Reopen this page in LINE and try again."
        )
      );
    } finally {
      setLoading(false);
    }
  }, [reloadSession]);

  useEffect(() => {
    if (!isReady || !isLoggedIn || !session || sessionLoading) return;

    const activeTrip = session.activeTrip;

    if (!activeTrip) {
      setVotes([]);
      return;
    }

    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await liffFetch(`/api/liff/votes?tripId=${activeTrip.id}`);
        if (!res.ok) throw new Error("Failed to load votes");
        const data = await res.json();
        setVotes(data.votes ?? []);
      } catch (err) {
        setLoadError(
          toLiffErrorMessage(
            "votes",
            err,
            "We could not load active votes right now. Reopen this page in LINE and try again."
          )
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [isReady, isLoggedIn, session, sessionLoading]);

  async function handleVote(tripItemId: string, optionId: string) {
    if (!session) return;

    setCastingFor(optionId);
    setVoteError(null);

    try {
      const res = await liffFetch("/api/liff/votes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tripItemId,
          optionId,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Vote failed");
      }

      await load();
    } catch (err) {
      setVoteError(
        toLiffErrorMessage(
          "cast-vote",
          err,
          "We could not submit your vote. Please try again."
        )
      );
    } finally {
      setCastingFor(null);
    }
  }

  if (!isReady) return <LoadingSpinner message="Initializing..." />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingSpinner message="Logging in..." />;
  if (sessionLoading && !session) return <ListSkeleton rows={3} />;
  if (sessionError && !session) return <ErrorScreen message={sessionError} onRetry={load} />;
  if (loading) return <ListSkeleton rows={3} />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={load} />;

  return (
    <div className="max-w-md mx-auto">
      <div className="sticky top-0 z-10 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)] px-4 py-3">
        <h1 className="font-bold text-base">Active Votes</h1>
        {session?.activeTrip && (
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {session.activeTrip.destination_name ?? "New trip"}
          </p>
        )}
      </div>

      {voteError && (
        <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
          {voteError}
        </div>
      )}

      {votes.length === 0 ? (
        <EmptyState
          emoji="Vote"
          title="No active votes"
          description={
            <>
              Type <code className="font-mono text-xs">/vote [item]</code> in chat to start a
              vote on a board item.
            </>
          }
        />
      ) : (
        <div className="px-4 pt-4 space-y-5 pb-4">
          {votes.map((vote) => (
            <VoteCard
              key={vote.item.id}
              vote={vote}
              onVote={handleVote}
              castingFor={castingFor}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VoteCard({
  vote,
  onVote,
  castingFor,
}: {
  vote: ActiveVote;
  onVote: (itemId: string, optionId: string) => void;
  castingFor: string | null;
}) {
  const hasVoted = vote.myVoteOptionId !== null;

  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 bg-[var(--secondary)] dark:bg-[#111] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{vote.item.title}</p>
          {vote.item.deadline_at && (
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Closes{" "}
              {new Date(vote.item.deadline_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-xs">
            {vote.totalVotes} vote{vote.totalVotes !== 1 ? "s" : ""}
          </Badge>
          {hasVoted && (
            <Badge className="text-xs bg-[var(--primary)] text-white border-0">Voted</Badge>
          )}
        </div>
      </div>

      {vote.options.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[var(--muted-foreground)] italic">
          No options yet. Use /vote in chat to add options.
        </p>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {vote.options.map((option) => (
            <OptionRow
              key={option.id}
              option={option}
              totalVotes={vote.totalVotes}
              isMyVote={vote.myVoteOptionId === option.id}
              isCasting={castingFor === option.id}
              onVote={() => onVote(vote.item.id, option.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OptionRow({
  option,
  totalVotes,
  isMyVote,
  isCasting,
  onVote,
}: {
  option: VoteOption;
  totalVotes: number;
  isMyVote: boolean;
  isCasting: boolean;
  onVote: () => void;
}) {
  const pct = totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 100) : 0;

  return (
    <div className={cn("p-4", isMyVote && "bg-[#f0fdf4] dark:bg-[#0d1a0d]")}>
      {option.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={option.image_url}
          alt={option.name}
          className="w-full h-28 object-cover rounded-xl mb-3"
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{option.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {option.rating && (
              <span className="text-xs text-[var(--muted-foreground)]">{option.rating}</span>
            )}
            {option.price_level && (
              <span className="text-xs text-[var(--muted-foreground)]">{option.price_level}</span>
            )}
            {option.booking_url && (
              <a
                href={option.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--primary)] underline underline-offset-2"
              >
                View
              </a>
            )}
          </div>
        </div>

        <Button
          size="sm"
          variant={isMyVote ? "default" : "outline"}
          onClick={onVote}
          disabled={isCasting}
          className={cn("shrink-0 text-xs h-8", isMyVote && "bg-[var(--primary)] text-white border-0")}
        >
          {isCasting ? "..." : isMyVote ? "Voted" : "Vote"}
        </Button>
      </div>

      {totalVotes > 0 && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isMyVote ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
            {option.voteCount} vote{option.voteCount !== 1 ? "s" : ""} · {pct}%
          </p>
        </div>
      )}
    </div>
  );
}

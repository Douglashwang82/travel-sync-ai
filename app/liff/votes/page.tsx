"use client";

import { useEffect, useState, useCallback } from "react";
import { useLiff } from "@/components/liff-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActiveVote, VoteOption } from "@/app/api/liff/votes/route";

type SessionData = {
  group: { id: string; lineGroupId: string };
  member: { lineUserId: string };
  activeTrip: { id: string; destination_name: string } | null;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VotesPage() {
  const { isReady, isLoggedIn, profile, lineGroupId, error } = useLiff();
  const [session, setSession] = useState<SessionData | null>(null);
  const [votes, setVotes] = useState<ActiveVote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [castingFor, setCastingFor] = useState<string | null>(null); // optionId being cast

  const load = useCallback(async () => {
    if (!profile || !lineGroupId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const sessionRes = await fetch(
        `/api/liff/session?lineGroupId=${encodeURIComponent(lineGroupId)}&lineUserId=${encodeURIComponent(profile.userId)}&displayName=${encodeURIComponent(profile.displayName)}`
      );
      if (!sessionRes.ok) throw new Error("Failed to load session");
      const sess: SessionData = await sessionRes.json();
      setSession(sess);

      if (!sess.activeTrip) {
        setVotes([]);
        return;
      }

      const params = new URLSearchParams({
        tripId: sess.activeTrip.id,
        lineUserId: profile.userId,
      });
      const res = await fetch(`/api/liff/votes?${params}`);
      if (!res.ok) throw new Error("Failed to load votes");
      const data = await res.json();
      setVotes(data.votes ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [profile, lineGroupId]);

  useEffect(() => {
    if (isReady && isLoggedIn) load();
  }, [isReady, isLoggedIn, load]);

  async function handleVote(tripItemId: string, optionId: string) {
    if (!session || !profile) return;

    // Get LIFF ID token for auth
    let idToken: string | null = null;
    try {
      const liff = (await import("@line/liff")).default;
      idToken = liff.getIDToken();
    } catch {
      alert("Unable to get auth token. Please reopen in LINE.");
      return;
    }

    if (!idToken) {
      alert("Not authenticated. Please reopen in LINE.");
      return;
    }

    setCastingFor(optionId);
    try {
      const res = await fetch("/api/liff/votes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tripItemId,
          optionId,
          lineGroupId: session.group.lineGroupId,
          groupId: session.group.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Vote failed");
      }

      // Refresh votes to reflect the new tally
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error casting vote");
    } finally {
      setCastingFor(null);
    }
  }

  // ── Render states ─────────────────────────────────────────────────────────

  if (!isReady) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;
  if (!isLoggedIn) return <LoadingScreen />;
  if (loading) return <LoadingScreen />;
  if (loadError) return <ErrorScreen message={loadError} onRetry={load} />;

  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--background)] border-b border-[var(--border)] px-4 py-3">
        <h1 className="font-bold text-base">🗳️ Active Votes</h1>
        {session?.activeTrip && (
          <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
            {session.activeTrip.destination_name}
          </p>
        )}
      </div>

      {votes.length === 0 ? (
        <EmptyState />
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

// ─── Sub-components ───────────────────────────────────────────────────────────

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
      {/* Item header */}
      <div className="px-4 py-3 bg-[var(--secondary)] dark:bg-[#111] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{vote.item.title}</p>
          {vote.item.deadline_at && (
            <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
              Closes {new Date(vote.item.deadline_at).toLocaleString(undefined, {
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
            <Badge className="text-xs bg-[var(--primary)] text-white border-0">
              Voted
            </Badge>
          )}
        </div>
      </div>

      {/* Options */}
      {vote.options.length === 0 ? (
        <p className="px-4 py-3 text-xs text-[var(--muted-foreground)] italic">
          No options yet. Use /vote in chat to add options.
        </p>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {vote.options.map((opt) => (
            <OptionRow
              key={opt.id}
              option={opt}
              totalVotes={vote.totalVotes}
              isMyVote={vote.myVoteOptionId === opt.id}
              isCasting={castingFor === opt.id}
              onVote={() => onVote(vote.item.id, opt.id)}
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
      {/* Option image */}
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
              <span className="text-xs text-[var(--muted-foreground)]">⭐ {option.rating}</span>
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
                View →
              </a>
            )}
          </div>
        </div>

        <Button
          size="sm"
          variant={isMyVote ? "default" : "outline"}
          onClick={onVote}
          disabled={isCasting}
          className={cn(
            "shrink-0 text-xs h-8",
            isMyVote && "bg-[var(--primary)] text-white border-0"
          )}
        >
          {isCasting ? "..." : isMyVote ? "✓ Voted" : "Vote"}
        </Button>
      </div>

      {/* Vote bar */}
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

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-[var(--secondary)] flex items-center justify-center text-3xl">
        🗳️
      </div>
      <div>
        <p className="font-semibold text-sm">No active votes</p>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Type{" "}
          <code className="font-mono text-xs">/vote [item]</code> in chat to
          start a vote on a board item.
        </p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-3">
      <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-[var(--muted-foreground)]">Loading votes...</p>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-6 text-center gap-3">
      <p className="text-3xl">⚠️</p>
      <p className="text-sm text-[var(--muted-foreground)]">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm text-[var(--primary)] underline underline-offset-2"
        >
          Tap to retry
        </button>
      )}
    </div>
  );
}

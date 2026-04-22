"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner, ErrorScreen } from "@/components/liff/shared";
import { appFetch, appFetchJson } from "@/lib/app-client";
import type { SignInMember } from "@/app/api/app/sign-in/route";

type MembersByGroup = Array<{
  groupId: string;
  groupName: string | null;
  lineGroupId: string;
  members: SignInMember[];
}>;

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "LINE Login is not configured for this deployment.",
  cancelled: "Sign in with LINE was cancelled.",
  invalid_callback: "The sign-in response from LINE was incomplete. Please try again.",
  missing_state: "We lost track of this sign-in attempt. Please start again.",
  invalid_state: "The sign-in session expired. Please start again.",
  state_mismatch:
    "Potential replay or cross-site attempt detected. Please retry the sign-in.",
  token_exchange_failed:
    "LINE accepted your sign-in but we could not redeem the authorization code.",
  missing_id_token: "LINE did not return an identity token. Please try again.",
  invalid_id_token:
    "We could not verify your LINE identity. Please try signing in again.",
  not_a_member:
    "This LINE account is not a member of any trip group yet. Add the TravelSync bot to a LINE group first.",
};

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const errorCode = searchParams.get("error");

  const [lineLoginConfigured, setLineLoginConfigured] = useState<boolean | null>(null);
  const [members, setMembers] = useState<SignInMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [signingInAs, setSigningInAs] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await appFetchJson<{ configured: boolean }>(
          "/api/app/auth/line/config"
        );
        if (cancelled) return;
        setLineLoginConfigured(config.configured);

        // Try the dev picker; in production with LINE Login configured it
        // intentionally 404s, which is fine — we fall through with an empty list.
        try {
          const data = await appFetchJson<{ members: SignInMember[] }>("/api/app/sign-in");
          if (!cancelled) setMembers(data.members);
        } catch {
          if (!cancelled) setMembers([]);
        }
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Failed to load sign-in");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped: MembersByGroup = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = term
      ? members.filter((m) => {
          const haystack = [
            m.displayName ?? "",
            m.lineUserId,
            m.groupName ?? "",
            m.lineGroupId,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(term);
        })
      : members;

    const map = new Map<string, MembersByGroup[number]>();
    for (const m of filtered) {
      const key = m.groupId;
      if (!map.has(key)) {
        map.set(key, {
          groupId: m.groupId,
          groupName: m.groupName,
          lineGroupId: m.lineGroupId,
          members: [],
        });
      }
      map.get(key)!.members.push(m);
    }
    return Array.from(map.values());
  }, [members, filter]);

  async function handlePick(lineUserId: string) {
    setSigningInAs(lineUserId);
    setActionError(null);
    try {
      const res = await appFetch("/api/app/sign-in", {
        method: "POST",
        body: JSON.stringify({ lineUserId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to sign in");
      }
      router.push(next ?? "/app");
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setSigningInAs(null);
    }
  }

  function handleLineLogin() {
    const url = next
      ? `/api/app/auth/line/start?next=${encodeURIComponent(next)}`
      : "/api/app/auth/line/start";
    window.location.href = url;
  }

  if (loading) return <LoadingSpinner message="Loading sign-in..." />;
  if (loadError) return <ErrorScreen message={loadError} />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Pick how you want to sign in to your trip workspace.
        </p>
      </div>

      {errorCode && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {LOGIN_ERROR_MESSAGES[errorCode] ??
            "Sign in failed. Please try again or use the member picker below."}
        </div>
      )}

      {lineLoginConfigured && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-semibold">Sign in with LINE</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Recommended. Uses the same LINE account you use inside the group chat.
          </p>
          <Button
            onClick={handleLineLogin}
            className="mt-3 w-full bg-[#06C755] text-white hover:bg-[#06C755]/90"
          >
            Continue with LINE
          </Button>
        </section>
      )}

      {!lineLoginConfigured && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-semibold">Dev mode.</strong> LINE Login is not
          configured on this deployment. Anyone visiting this page can impersonate any
          known member. Set <code className="font-mono">LINE_LOGIN_CHANNEL_ID</code> /{" "}
          <code className="font-mono">LINE_LOGIN_CHANNEL_SECRET</code> to enable real
          sign in.
        </div>
      )}

      {members.length > 0 && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {lineLoginConfigured ? "Dev sign-in (staging only)" : "Pick a member"}
            </h2>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {members.length} member{members.length === 1 ? "" : "s"}
            </span>
          </header>
          <div className="mt-4 space-y-3">
            <Input
              placeholder="Filter by name, group, or LINE ID"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />

            {actionError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {actionError}
              </div>
            )}

            <div className="space-y-4">
              {grouped.map((g) => (
                <section
                  key={g.groupId}
                  className="rounded-2xl border border-[var(--border)]"
                >
                  <header className="border-b border-[var(--border)] px-4 py-3">
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {g.groupName ?? "Untitled LINE group"}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--muted-foreground)]">
                      {g.lineGroupId}
                    </p>
                  </header>
                  <ul className="divide-y divide-[var(--border)]">
                    {g.members.map((m) => {
                      const isLoading = signingInAs === m.lineUserId;
                      return (
                        <li
                          key={`${g.groupId}-${m.lineUserId}`}
                          className="flex items-center gap-3 px-4 py-3"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {m.displayName ?? "Unknown"}
                              {m.role === "organizer" && (
                                <span className="ml-2 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
                                  organizer
                                </span>
                              )}
                            </p>
                            <p className="truncate font-mono text-[11px] text-[var(--muted-foreground)]">
                              {m.lineUserId}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handlePick(m.lineUserId)}
                            disabled={signingInAs !== null}
                            className="h-8 shrink-0 rounded-full px-3 text-xs"
                          >
                            {isLoading ? "Signing in..." : "Continue"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

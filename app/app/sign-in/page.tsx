"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function SignInPage() {
  const router = useRouter();
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
        const data = await appFetchJson<{ members: SignInMember[] }>("/api/app/sign-in");
        if (!cancelled) setMembers(data.members);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Failed to load members");
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
      router.push("/app");
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to sign in");
    } finally {
      setSigningInAs(null);
    }
  }

  if (loading) return <LoadingSpinner message="Loading members..." />;
  if (loadError) return <ErrorScreen message={loadError} />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          While web-native auth is being built, pick the member you want to act as.
          This uses the same identity the LINE bot has seen in your group chat.
        </p>
      </div>

      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
        <strong className="font-semibold">Dev mode.</strong> Anyone visiting this page can
        impersonate any member. Replace this sign-in screen with LINE Login before rolling
        it out to real users.
      </div>

      {members.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 text-center">
          <p className="text-sm font-semibold">No members yet</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Add the TravelSync bot to a LINE group and send a message so members get
            registered. Then come back here.
          </p>
        </div>
      ) : (
        <>
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
                className="rounded-2xl border border-[var(--border)] bg-[var(--background)]"
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
                        key={`${m.groupId}-${m.lineUserId}`}
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
        </>
      )}
    </div>
  );
}

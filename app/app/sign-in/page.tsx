"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner, ErrorScreen } from "@/components/liff/shared";
import { appFetch, appFetchJson } from "@/lib/app-client";
import { clearAppBrowserCache } from "@/lib/app-browser-cache";
import type { SignInMember } from "@/app/api/app/sign-in/route";

type MembersByGroup = Array<{
  groupId: string;
  groupName: string | null;
  lineGroupId: string;
  members: SignInMember[];
}>;

const COPY = {
  en: {
    loading: "Loading sign-in...",
    title: "Sign in",
    subtitle: "Pick how you want to sign in to your trip workspace.",
    loginErrors: {
      not_configured: "LINE Login is not configured for this deployment.",
      cancelled: "Sign in with LINE was cancelled.",
      invalid_callback: "The sign-in response from LINE was incomplete. Please try again.",
      missing_state: "We lost track of this sign-in attempt. Please start again.",
      invalid_state: "The sign-in session expired. Please start again.",
      state_mismatch: "Potential replay or cross-site attempt detected. Please retry the sign-in.",
      token_exchange_failed: "LINE accepted your sign-in but we could not redeem the authorization code.",
      missing_id_token: "LINE did not return an identity token. Please try again.",
      invalid_id_token: "We could not verify your LINE identity. Please try signing in again.",
      not_a_member:
        "This LINE account is not a member of any trip group yet. Add the TravelSync bot to a LINE group first.",
    },
    loginFailed: "Sign in failed. Please try again or use the member picker below.",
    lineSectionTitle: "Sign in with LINE",
    lineSectionBody: "Recommended. Uses the same LINE account you use inside the group chat.",
    continueWithLine: "Continue with LINE",
    devMode: "Dev mode.",
    devModeBody:
      "LINE Login is not configured on this deployment. Anyone visiting this page can impersonate any known member. Set LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET to enable real sign in.",
    devSignIn: "Dev sign-in (staging only)",
    pickMember: "Pick a member",
    members: (count: number) => `${count} member${count === 1 ? "" : "s"}`,
    filterPlaceholder: "Filter by name, group, or LINE ID",
    untitledLineGroup: "Untitled LINE group",
    unknown: "Unknown",
    organizer: "organizer",
    signingIn: "Signing in...",
    continue: "Continue",
  },
  "zh-TW": {
    loading: "正在載入登入頁面...",
    title: "登入",
    subtitle: "選擇你要如何登入旅程工作區。",
    loginErrors: {
      not_configured: "此部署尚未設定 LINE Login。",
      cancelled: "已取消使用 LINE 登入。",
      invalid_callback: "LINE 回傳的登入資訊不完整，請再試一次。",
      missing_state: "這次登入流程的狀態已遺失，請重新開始。",
      invalid_state: "登入工作階段已過期，請重新開始。",
      state_mismatch: "偵測到可能的重放或跨站請求，請重新登入。",
      token_exchange_failed: "LINE 已接受登入，但我們無法兌換授權碼。",
      missing_id_token: "LINE 沒有回傳 identity token，請再試一次。",
      invalid_id_token: "我們無法驗證你的 LINE 身分，請重新登入。",
      not_a_member: "這個 LINE 帳號尚未加入任何旅遊群組。請先把 TravelSync 機器人加進 LINE 群組。",
    },
    loginFailed: "登入失敗。請再試一次，或改用下方的成員選擇器。",
    lineSectionTitle: "使用 LINE 登入",
    lineSectionBody: "建議使用。這會使用你在群組聊天中使用的同一個 LINE 帳號。",
    continueWithLine: "使用 LINE 繼續",
    devMode: "開發模式。",
    devModeBody:
      "此部署尚未設定 LINE Login。任何造訪此頁面的人都可以模擬任一已知成員。設定 LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET 後即可啟用正式登入。",
    devSignIn: "開發登入（僅限 staging）",
    pickMember: "選擇成員",
    members: (count: number) => `${count} 位成員`,
    filterPlaceholder: "依姓名、群組或 LINE ID 篩選",
    untitledLineGroup: "未命名 LINE 群組",
    unknown: "未知使用者",
    organizer: "發起人",
    signingIn: "登入中...",
    continue: "繼續",
  },
} as const;

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useAppLocale();
  const next = searchParams.get("next");
  const errorCode = searchParams.get("error");
  const copy = COPY[locale];

  const [lineLoginConfigured, setLineLoginConfigured] = useState<boolean | null>(null);
  const [members, setMembers] = useState<SignInMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [signingInAs, setSigningInAs] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    clearAppBrowserCache();
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
      clearAppBrowserCache();
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

  if (loading) return <LoadingSpinner message={copy.loading} />;
  if (loadError) return <ErrorScreen message={loadError} />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">{copy.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {copy.subtitle}
        </p>
      </div>

      {errorCode && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {copy.loginErrors[errorCode as keyof typeof copy.loginErrors] ?? copy.loginFailed}
        </div>
      )}

      {lineLoginConfigured && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-semibold">{copy.lineSectionTitle}</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {copy.lineSectionBody}
          </p>
          <Button
            onClick={handleLineLogin}
            className="mt-3 w-full bg-[#06C755] text-white hover:bg-[#06C755]/90"
          >
            {copy.continueWithLine}
          </Button>
        </section>
      )}

      {!lineLoginConfigured && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-semibold">{copy.devMode}</strong> {copy.devModeBody.split("LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET")[0]}
          <code className="font-mono">LINE_LOGIN_CHANNEL_ID</code> / <code className="font-mono">LINE_LOGIN_CHANNEL_SECRET</code>
          {copy.devModeBody.split("LINE_LOGIN_CHANNEL_ID / LINE_LOGIN_CHANNEL_SECRET")[1]}
        </div>
      )}

      {members.length > 0 && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--background)] p-5">
          <header className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {lineLoginConfigured ? copy.devSignIn : copy.pickMember}
            </h2>
            <span className="text-[11px] text-[var(--muted-foreground)]">
              {copy.members(members.length)}
            </span>
          </header>
          <div className="mt-4 space-y-3">
            <Input
              placeholder={copy.filterPlaceholder}
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
                      {g.groupName ?? copy.untitledLineGroup}
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
                              {m.displayName ?? copy.unknown}
                              {m.role === "organizer" && (
                                <span className="ml-2 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#166534] dark:bg-[#14532d] dark:text-[#86efac]">
                                  {copy.organizer}
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
                            {isLoading ? copy.signingIn : copy.continue}
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

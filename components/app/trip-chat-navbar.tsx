"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TripChatRoom } from "@/components/app/trip-chat-room";
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import { useAppLocale } from "@/components/app/app-locale-provider";
import type { AppLocale } from "@/lib/app-locale";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { CustomGrid } from "@/app/api/app/trips/[tripId]/custom-grids/route";
import type { PublicAgent } from "@/services/agents/registry";

const COPY: Record<
  AppLocale,
  {
    open: string;
    title: string;
    members: string;
    agents: string;
    noMembers: string;
    noAgents: string;
    you: string;
    loading: string;
    failed: string;
    retry: string;
  }
> = {
  en: {
    open: "Open chat",
    title: "Chat",
    members: "Members",
    agents: "Active AI agents",
    noMembers: "No other members yet.",
    noAgents: "No AI agents added to this trip yet.",
    you: "You",
    loading: "Loading…",
    failed: "Failed to load",
    retry: "Retry",
  },
  "zh-TW": {
    open: "開啟聊天",
    title: "聊天",
    members: "成員",
    agents: "活躍 AI 代理人",
    noMembers: "目前沒有其他成員。",
    noAgents: "尚未為此旅程加入 AI 代理人。",
    you: "你",
    loading: "載入中…",
    failed: "載入失敗",
    retry: "重試",
  },
};

interface TripChatNavbarProps {
  tripId: string;
  currentAppUserId: string;
}

type SelectedTarget = React.ComponentProps<typeof TripChatRoom>["target"];

export function TripChatNavbar({ tripId, currentAppUserId }: TripChatNavbarProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<AppMember[] | null>(null);
  const [grids, setGrids] = useState<CustomGrid[] | null>(null);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [chatTarget, setChatTarget] = useState<SelectedTarget>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [m, g, a] = await Promise.all([
        appFetchJson<{ members: AppMember[] }>(`/api/app/trips/${tripId}/members`),
        appFetchJson<{ grids: CustomGrid[] }>(`/api/app/trips/${tripId}/custom-grids`),
        appFetchJson<{ agents: PublicAgent[] }>(`/api/app/agents`),
      ]);
      setMembers(m.members);
      setGrids(g.grids);
      setAgents(a.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [tripId]);

  useEffect(() => {
    if (!open || members !== null || grids !== null) return;
    void (async () => {
      await load();
    })();
  }, [open, members, grids, load]);

  const agentByType = new Map<string, PublicAgent>(agents.map((a) => [a.type, a]));

  const otherMembers = (members ?? []).filter(
    (m) => m.appUserId && m.appUserId !== currentAppUserId,
  );
  const activeGrids = (grids ?? []).filter((g) => g.isActive);

  function openMemberChat(m: AppMember) {
    if (!m.appUserId) return;
    setChatTarget({
      title: m.displayName ?? "Member",
      subtitle: m.role,
      avatarLabel: m.displayName ?? "?",
      request: { kind: "member_dm", targetAppUserId: m.appUserId },
    });
    setChatOpen(true);
  }

  function openAgentChat(g: CustomGrid) {
    const agent = agentByType.get(g.agentType);
    setChatTarget({
      title: g.title,
      subtitle: agent?.label ?? g.agentType,
      avatarLabel: g.title,
      icon: agent?.icon,
      request: { kind: "agent", customGridId: g.id },
    });
    setChatOpen(true);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={copy.open}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
          >
            <MessageSquare className="h-3 w-3" aria-hidden />
            {copy.title}
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="flex flex-col gap-4 p-4 sm:max-w-xs">
          <SheetHeader>
            <SheetTitle className="text-base">{copy.title}</SheetTitle>
          </SheetHeader>

          {error && (
            <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
              <span>{copy.failed}</span>
              <button
                type="button"
                onClick={() => void load()}
                className="font-semibold underline"
              >
                {copy.retry}
              </button>
            </div>
          )}

          <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                {copy.members}
              </h3>
              {members === null ? (
                <SkeletonRows />
              ) : otherMembers.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{copy.noMembers}</p>
              ) : (
                <ul className="space-y-1">
                  {otherMembers.map((m) => (
                    <li key={m.lineUserId}>
                      <button
                        type="button"
                        onClick={() => openMemberChat(m)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5 text-left",
                          "hover:bg-[var(--surface-sunken)]",
                        )}
                      >
                        <span
                          aria-hidden
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-line-soft)] text-sm font-semibold text-[var(--accent-line)]"
                        >
                          {(m.displayName ?? "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--text-primary)]">
                            {m.displayName ?? "Unknown"}
                          </span>
                          <span className="block text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                            {m.role}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
                {copy.agents}
              </h3>
              {grids === null ? (
                <SkeletonRows />
              ) : activeGrids.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{copy.noAgents}</p>
              ) : (
                <ul className="space-y-1">
                  {activeGrids.map((g) => {
                    const agent = agentByType.get(g.agentType);
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => openAgentChat(g)}
                          className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                        >
                          <span
                            aria-hidden
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--status-needs-decision-soft)] text-sm text-[var(--status-needs-decision)]"
                          >
                            {agent?.icon ?? "✨"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[var(--text-primary)]">
                              {g.title}
                            </span>
                            <span className="block truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                              {agent?.label ?? g.agentType}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </SheetContent>
      </Sheet>

      <TripChatRoom
        tripId={tripId}
        currentAppUserId={currentAppUserId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        target={chatTarget}
      />
    </>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-10 rounded-[var(--radius-md)]" />
      ))}
    </div>
  );
}

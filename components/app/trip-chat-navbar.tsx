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
import type { UnreadOverview } from "@/app/api/app/trips/[tripId]/chat/unread/route";

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
type Copy = (typeof COPY)[AppLocale];

const EMPTY_UNREAD: UnreadOverview = {
  total: 0,
  byMemberAppUserId: {},
  byCustomGridId: {},
};

const UNREAD_REFRESH_MS = 30_000;

/**
 * Trip chat navbar. Two presentations sharing one data layer:
 *   • lg+: a fixed right rail (`<aside>`), always visible alongside the trip
 *     workspace. Layout reserves the gutter via `lg:pr-72` in `app-shell`.
 *   • <lg: a Sheet drawer triggered by a chip in the breadcrumb.
 */
export function TripChatNavbar({ tripId, currentAppUserId }: TripChatNavbarProps) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<AppMember[] | null>(null);
  const [grids, setGrids] = useState<CustomGrid[] | null>(null);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [unread, setUnread] = useState<UnreadOverview>(EMPTY_UNREAD);
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

  const refreshUnread = useCallback(async () => {
    try {
      const res = await appFetchJson<UnreadOverview>(
        `/api/app/trips/${tripId}/chat/unread`,
      );
      setUnread(res);
    } catch {
      // Silent — unread counts are non-critical.
    }
  }, [tripId]);

  // Load member + agent lists on mount so the fixed rail is populated even
  // before the drawer is opened.
  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    void (async () => {
      await refreshUnread();
    })();
    const id = setInterval(() => {
      void (async () => {
        await refreshUnread();
      })();
    }, UNREAD_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshUnread]);

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
    setOpen(false);
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
    setOpen(false);
  }

  const panelProps: ChatPanelProps = {
    copy,
    error,
    onRetry: load,
    members,
    otherMembers,
    grids,
    activeGrids,
    agentByType,
    unread,
    onOpenMember: openMemberChat,
    onOpenAgent: openAgentChat,
  };

  return (
    <>
      {/* Mobile + tablet: the existing drawer + breadcrumb chip. */}
      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={copy.open}
              className="relative inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
            >
              <MessageSquare className="h-3 w-3" aria-hidden />
              {copy.title}
              {unread.total > 0 && (
                <span
                  aria-label={`${unread.total} unread`}
                  className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-line)] px-1 text-[9px] font-semibold text-white"
                >
                  {unread.total > 99 ? "99+" : unread.total}
                </span>
              )}
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="flex flex-col gap-4 p-4 sm:max-w-xs">
            <SheetHeader>
              <SheetTitle className="text-base">{copy.title}</SheetTitle>
            </SheetHeader>
            <ChatPanel {...panelProps} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: fixed right rail. Width matches `lg:pr-72` in app-shell. */}
      <aside
        id="trip-chat-rail"
        aria-label={copy.title}
        className="hidden lg:fixed lg:right-0 lg:top-0 lg:z-30 lg:flex lg:h-screen lg:w-72 lg:flex-col lg:gap-3 lg:border-l lg:border-[var(--border-hairline)] lg:bg-[var(--surface-base)] lg:p-4"
      >
        <header className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <MessageSquare className="h-4 w-4" aria-hidden />
            {copy.title}
          </h2>
          {unread.total > 0 && (
            <span
              aria-label={`${unread.total} unread`}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-line)] px-1.5 text-[10px] font-semibold text-white"
            >
              {unread.total > 99 ? "99+" : unread.total}
            </span>
          )}
        </header>
        <ChatPanel {...panelProps} />
      </aside>

      <TripChatRoom
        tripId={tripId}
        currentAppUserId={currentAppUserId}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        target={chatTarget}
        onMarkedRead={() => void refreshUnread()}
      />
    </>
  );
}

interface ChatPanelProps {
  copy: Copy;
  error: string | null;
  onRetry: () => Promise<void> | void;
  members: AppMember[] | null;
  otherMembers: AppMember[];
  grids: CustomGrid[] | null;
  activeGrids: CustomGrid[];
  agentByType: Map<string, PublicAgent>;
  unread: UnreadOverview;
  onOpenMember: (m: AppMember) => void;
  onOpenAgent: (g: CustomGrid) => void;
}

function ChatPanel({
  copy,
  error,
  onRetry,
  members,
  otherMembers,
  grids,
  activeGrids,
  agentByType,
  unread,
  onOpenMember,
  onOpenAgent,
}: ChatPanelProps) {
  return (
    <>
      {error && (
        <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
          <span>{copy.failed}</span>
          <button
            type="button"
            onClick={() => void onRetry()}
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
              {otherMembers.map((m) => {
                const count = m.appUserId ? unread.byMemberAppUserId[m.appUserId] ?? 0 : 0;
                return (
                  <li key={m.lineUserId}>
                    <button
                      type="button"
                      onClick={() => onOpenMember(m)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5 text-left",
                        "hover:bg-[var(--surface-sunken)]",
                      )}
                    >
                      <span
                        aria-hidden
                        className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-line-soft)] text-sm font-semibold text-[var(--accent-line)]"
                      >
                        {(m.displayName ?? "?").slice(0, 1).toUpperCase()}
                        {count > 0 && <UnreadDot />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--text-primary)]">
                          {m.displayName ?? "Unknown"}
                        </span>
                        <span className="block text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                          {m.role}
                        </span>
                      </span>
                      {count > 0 && <UnreadCount count={count} />}
                    </button>
                  </li>
                );
              })}
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
                const count = unread.byCustomGridId[g.id] ?? 0;
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => onOpenAgent(g)}
                      className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5 text-left hover:bg-[var(--surface-sunken)]"
                    >
                      <span
                        aria-hidden
                        className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--status-needs-decision-soft)] text-sm text-[var(--status-needs-decision)]"
                      >
                        {agent?.icon ?? "✨"}
                        {count > 0 && <UnreadDot />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-[var(--text-primary)]">
                          {g.title}
                        </span>
                        <span className="block truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                          {agent?.label ?? g.agentType}
                        </span>
                      </span>
                      {count > 0 && <UnreadCount count={count} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
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

function UnreadDot() {
  return (
    <span
      aria-hidden
      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface-raised)] bg-[var(--accent-line)]"
    />
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-line)] px-1 text-[9px] font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

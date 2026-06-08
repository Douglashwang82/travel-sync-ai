"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Plus, Users, ChevronDown, Wrench, Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TripChatRoom } from "@/components/app/trip-chat-room";
import { CustomGrid } from "@/components/app/grids/custom-grid";
import { AddCustomGridDialog } from "@/components/app/grids/add-custom-grid-dialog";
import {
  GRIDS_CHANGED_EVENT,
  CHAT_TASK_DRAG_TYPE,
  CHAT_BUBBLE_DRAG_TYPE,
  CHAT_TASK_DISPATCHED_EVENT,
  type ChatTaskDragPayload,
  type ChatBubbleDragPayload,
  type ChatTaskDispatchedDetail,
} from "@/components/app/trip-workspace-events";
import { appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import { springPop, springSnappy } from "@/components/motion/variants";
import { useAppLocale } from "@/components/app/app-locale-provider";
import type { AppLocale } from "@/lib/app-locale";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { CustomGrid as CustomGridData } from "@/app/api/app/trips/[tripId]/custom-grids/route";
import type { PublicAgent } from "@/services/agents/registry";
import type { UnreadOverview } from "@/app/api/app/trips/[tripId]/chat/unread/route";
import type { DispatchedTask } from "@/services/orchestrator";
import type {
  DispatchedTasksResponse,
  DispatchTaskResponse,
} from "@/app/api/app/trips/[tripId]/dispatched-tasks/route";

const COPY: Record<
  AppLocale,
  {
    open: string;
    title: string;
    grids: string;
    addGrid: string;
    noGrids: string;
    people: string;
    members: string;
    agents: string;
    noMembers: string;
    noAgents: string;
    loading: string;
    failed: string;
    retry: string;
    dispatched: string;
    dispatchedHint: string;
    dispatchedQueued: string;
    dispatchedWorking: string;
    dispatchedFailed: string;
    tools: string;
    toolOverview: string;
    toolItinerary: string;
    toolVotes: string;
    toolExpenses: string;
    toolIdeas: string;
    toolMap: string;
    toolPack: string;
  }
> = {
  en: {
    open: "Grids & people",
    title: "Workspace",
    grids: "Grids",
    addGrid: "Add grid",
    noGrids: "No grids yet. Chat about the trip and the AI planner will suggest some — or add one.",
    people: "People",
    members: "Members",
    agents: "Agent chats",
    noMembers: "No other members yet.",
    noAgents: "No agent grids yet.",
    loading: "Loading…",
    failed: "Failed to load",
    retry: "Retry",
    dispatched: "Dispatched tasks",
    dispatchedHint: "Drop a chat message here to hand it to the AI planner.",
    dispatchedQueued: "Queued…",
    dispatchedWorking: "Working…",
    dispatchedFailed: "Couldn’t finish",
    tools: "Trip tools",
    toolOverview: "Overview",
    toolItinerary: "Itinerary",
    toolVotes: "Votes",
    toolExpenses: "Expenses",
    toolIdeas: "Ideas",
    toolMap: "Map",
    toolPack: "Pack",
  },
  "zh-TW": {
    open: "格子與成員",
    title: "工作區",
    grids: "格子",
    addGrid: "新增格子",
    noGrids: "尚無格子。聊聊旅程，AI 規劃助手會提供建議，或自行新增。",
    people: "成員",
    members: "成員",
    agents: "代理人對話",
    noMembers: "目前沒有其他成員。",
    noAgents: "尚無代理人格子。",
    loading: "載入中…",
    failed: "載入失敗",
    retry: "重試",
    dispatched: "派發任務",
    dispatchedHint: "把聊天訊息拖放到這裡，交給 AI 規劃助手處理。",
    dispatchedQueued: "排隊中…",
    dispatchedWorking: "處理中…",
    dispatchedFailed: "無法完成",
    tools: "旅程工具",
    toolOverview: "總覽",
    toolItinerary: "行程",
    toolVotes: "投票",
    toolExpenses: "支出",
    toolIdeas: "靈感",
    toolMap: "地圖",
    toolPack: "打包",
  },
};

/** Sub-pages reachable from the rail now that the chat room is the landing. */
const TOOL_LINKS: { seg: string; key: keyof (typeof COPY)["en"] }[] = [
  { seg: "overview", key: "toolOverview" },
  { seg: "itinerary", key: "toolItinerary" },
  { seg: "votes", key: "toolVotes" },
  { seg: "expenses", key: "toolExpenses" },
  { seg: "ideas", key: "toolIdeas" },
  { seg: "map", key: "toolMap" },
  { seg: "pack", key: "toolPack" },
];

type Copy = (typeof COPY)[AppLocale];
type SelectedTarget = React.ComponentProps<typeof TripChatRoom>["target"];

const EMPTY_UNREAD: UnreadOverview = {
  total: 0,
  byMemberAppUserId: {},
  byCustomGridId: {},
};

const UNREAD_REFRESH_MS = 30_000;

/**
 * The trip workspace right rail. Replaces the old chat navbar: the AI planner's
 * confirmed bento grids are the primary content (top), with people (member DMs
 * + agent chats) in a secondary section below. Two presentations share one data
 * layer — a fixed `<aside>` on lg+, a `Sheet` drawer on smaller screens.
 */
export function TripGridsRail({
  tripId,
  currentAppUserId,
}: {
  tripId: string;
  currentAppUserId: string;
}) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];
  const [open, setOpen] = useState(false);
  const [grids, setGrids] = useState<CustomGridData[] | null>(null);
  const [members, setMembers] = useState<AppMember[] | null>(null);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [unread, setUnread] = useState<UnreadOverview>(EMPTY_UNREAD);
  const [error, setError] = useState<string | null>(null);
  const [chatTarget, setChatTarget] = useState<SelectedTarget>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [prefill, setPrefill] = useState<
    { agentType: string; title?: string; config?: Record<string, unknown> } | null
  >(null);
  const [panelGridId, setPanelGridId] = useState<string | null>(null);
  const [dispatched, setDispatched] = useState<DispatchedTask[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [g, m, a] = await Promise.all([
        appFetchJson<{ grids: CustomGridData[] }>(`/api/app/trips/${tripId}/custom-grids`),
        appFetchJson<{ members: AppMember[] }>(`/api/app/trips/${tripId}/members`),
        appFetchJson<{ agents: PublicAgent[] }>(`/api/app/agents`),
      ]);
      setGrids(g.grids);
      setMembers(m.members);
      setAgents(a.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [tripId]);

  const refreshGrids = useCallback(async () => {
    try {
      const g = await appFetchJson<{ grids: CustomGridData[] }>(
        `/api/app/trips/${tripId}/custom-grids`,
      );
      setGrids(g.grids);
    } catch {
      // Non-critical; next interaction retries.
    }
  }, [tripId]);

  const refreshUnread = useCallback(async () => {
    try {
      setUnread(await appFetchJson<UnreadOverview>(`/api/app/trips/${tripId}/chat/unread`));
    } catch {
      // Silent — unread counts are non-critical.
    }
  }, [tripId]);

  const refreshDispatched = useCallback(async () => {
    try {
      const res = await appFetchJson<DispatchedTasksResponse>(
        `/api/app/trips/${tripId}/dispatched-tasks`,
      );
      setDispatched(res.tasks);
    } catch {
      // Non-critical — next poll retries.
    }
  }, [tripId]);

  // A chat bubble was dropped on the "Dispatched tasks" zone. Record it (the
  // server kicks off a focused AI run) and show it resolving via an optimistic
  // pending row that the server row then replaces.
  const handleDispatchBubble = useCallback(
    async (payload: ChatBubbleDragPayload) => {
      const text = payload.text.trim();
      if (!text) return;
      const optimistic: DispatchedTask = {
        id: `optimistic-${Date.now()}`,
        text,
        messageId: payload.messageId,
        status: "pending",
        summary: null,
        runId: null,
        createdBy: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      };
      setDispatched((prev) => [optimistic, ...(prev ?? [])]);
      try {
        const res = await appFetchJson<DispatchTaskResponse>(
          `/api/app/trips/${tripId}/dispatched-tasks`,
          { method: "POST", body: JSON.stringify({ text, messageId: payload.messageId }) },
        );
        setDispatched((prev) =>
          (prev ?? []).map((t) => (t.id === optimistic.id ? res.task : t)),
        );
        // Tell the chat to mark this bubble dispatched (highlight + lock drag).
        window.dispatchEvent(
          new CustomEvent<ChatTaskDispatchedDetail>(CHAT_TASK_DISPATCHED_EVENT, {
            detail: { messageId: payload.messageId },
          }),
        );
      } catch {
        setDispatched((prev) => (prev ?? []).filter((t) => t.id !== optimistic.id));
      }
      void refreshDispatched();
    },
    [tripId, refreshDispatched],
  );

  // A chat bubble was dropped on the grids section. Try to create the grid
  // immediately; if the extracted config is incomplete (server rejects it),
  // fall back to the Add-grid dialog prefilled so the user finishes it.
  const handleDropChatTask = useCallback(
    async (payload: ChatTaskDragPayload) => {
      try {
        const res = await appFetchJson<{ grid: CustomGridData }>(
          `/api/app/trips/${tripId}/custom-grids`,
          {
            method: "POST",
            body: JSON.stringify({
              agentType: payload.agentType,
              title: payload.title,
              config: payload.config,
            }),
          },
        );
        setGrids((prev) => [...(prev ?? []), res.grid]);
        window.dispatchEvent(new CustomEvent(GRIDS_CHANGED_EVENT));
      } catch {
        setPrefill({
          agentType: payload.agentType,
          title: payload.title,
          config: payload.config,
        });
        setAddOpen(true);
      }
    },
    [tripId],
  );

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  // Refetch grids when the chat confirms a proposed grid.
  useEffect(() => {
    const handler = () => void refreshGrids();
    window.addEventListener(GRIDS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(GRIDS_CHANGED_EVENT, handler);
  }, [refreshGrids]);

  useEffect(() => {
    void (async () => {
      await refreshUnread();
    })();
    const id = setInterval(() => void refreshUnread(), UNREAD_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshUnread]);

  // Poll dispatched tasks — fast while any is queued/running so the outcome
  // lands quickly, slow otherwise.
  const hasActiveDispatch = (dispatched ?? []).some(
    (t) => t.status === "pending" || t.status === "running",
  );
  useEffect(() => {
    void (async () => {
      await refreshDispatched();
    })();
    const id = setInterval(
      () => void refreshDispatched(),
      hasActiveDispatch ? 4_000 : 30_000,
    );
    return () => clearInterval(id);
  }, [refreshDispatched, hasActiveDispatch]);

  // A dispatch happened (here or from the chat composer) — refresh promptly so
  // the new task shows without waiting for the slow poll.
  useEffect(() => {
    const handler = () => void refreshDispatched();
    window.addEventListener(CHAT_TASK_DISPATCHED_EVENT, handler);
    return () => window.removeEventListener(CHAT_TASK_DISPATCHED_EVENT, handler);
  }, [refreshDispatched]);

  const agentByType = useMemo(
    () => new Map<string, PublicAgent>(agents.map((a) => [a.type, a])),
    [agents],
  );

  const otherMembers = (members ?? []).filter(
    (m) => m.appUserId && m.appUserId !== currentAppUserId,
  );
  const activeGrids = (grids ?? []).filter((g) => g.isActive);
  const panelGrid = activeGrids.find((g) => g.id === panelGridId) ?? null;

  const handleGridChange = useCallback((next: CustomGridData) => {
    setGrids((prev) => (prev ? prev.map((g) => (g.id === next.id ? next : g)) : prev));
  }, []);
  const handleGridDelete = useCallback((id: string) => {
    setGrids((prev) => (prev ? prev.filter((g) => g.id !== id) : prev));
    setPanelGridId((cur) => (cur === id ? null : cur));
  }, []);

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

  function openAgentChat(g: CustomGridData) {
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

  const bodyProps: RailBodyProps = {
    copy,
    tripId,
    onDropChatTask: handleDropChatTask,
    dispatched,
    onDispatchBubble: handleDispatchBubble,
    error,
    onRetry: load,
    grids,
    activeGrids,
    members,
    otherMembers,
    agentByType,
    unread,
    onOpenGrid: (id) => {
      setPanelGridId(id);
      setOpen(false);
    },
    onAddGrid: () => {
      setAddOpen(true);
      setOpen(false);
    },
    onOpenMember: openMemberChat,
    onOpenAgent: openAgentChat,
  };

  return (
    <>
      {/* Mobile + tablet: a drawer launched from the header chip. */}
      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={copy.open}
              className="relative inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <LayoutGrid className="h-3 w-3" aria-hidden />
              {copy.title}
              {(activeGrids.length > 0 || unread.total > 0) && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-line)] px-1 text-[9px] font-semibold text-white">
                  {activeGrids.length + unread.total > 99 ? "99+" : activeGrids.length + unread.total}
                </span>
              )}
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="flex flex-col gap-4 overflow-y-auto p-4 sm:max-w-xs">
            <SheetHeader>
              <SheetTitle className="text-base tracking-tight [font-family:var(--font-display)]">
                {copy.title}
              </SheetTitle>
            </SheetHeader>
            <RailBody {...bodyProps} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: fixed right rail. Width matches `lg:pr-72` in app-shell. */}
      <aside
        id="trip-chat-rail"
        aria-label={copy.title}
        className="hidden lg:fixed lg:right-0 lg:top-0 lg:z-30 lg:flex lg:h-screen lg:w-72 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:border-l lg:border-[var(--border-hairline)] lg:bg-[var(--surface-base)] lg:p-4"
      >
        <header className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-[var(--text-primary)] [font-family:var(--font-display)]">
          <LayoutGrid className="h-4 w-4" aria-hidden />
          {copy.title}
        </header>
        <RailBody {...bodyProps} />
      </aside>

      <AddCustomGridDialog
        tripId={tripId}
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) setPrefill(null);
        }}
        prefill={prefill}
        onCreated={(grid) => setGrids((prev) => [...(prev ?? []), grid])}
      />

      {/* Grid panel — opens a single grid over the workspace. */}
      <Dialog open={panelGrid !== null} onOpenChange={(v) => !v && setPanelGridId(null)}>
        <DialogContent className="max-h-[85vh] w-[95vw] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold tracking-tight [font-family:var(--font-display)]">
              {panelGrid?.title}
            </DialogTitle>
          </DialogHeader>
          {panelGrid && (
            <CustomGrid
              tripId={tripId}
              grid={panelGrid}
              onChange={handleGridChange}
              onDelete={handleGridDelete}
            />
          )}
        </DialogContent>
      </Dialog>

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

interface RailBodyProps {
  copy: Copy;
  tripId: string;
  onDropChatTask: (payload: ChatTaskDragPayload) => void;
  dispatched: DispatchedTask[] | null;
  onDispatchBubble: (payload: ChatBubbleDragPayload) => void;
  error: string | null;
  onRetry: () => Promise<void> | void;
  grids: CustomGridData[] | null;
  activeGrids: CustomGridData[];
  members: AppMember[] | null;
  otherMembers: AppMember[];
  agentByType: Map<string, PublicAgent>;
  unread: UnreadOverview;
  onOpenGrid: (id: string) => void;
  onAddGrid: () => void;
  onOpenMember: (m: AppMember) => void;
  onOpenAgent: (g: CustomGridData) => void;
}

function RailBody({
  copy,
  tripId,
  onDropChatTask,
  dispatched,
  onDispatchBubble,
  error,
  onRetry,
  grids,
  activeGrids,
  members,
  otherMembers,
  agentByType,
  unread,
  onOpenGrid,
  onAddGrid,
  onOpenMember,
  onOpenAgent,
}: RailBodyProps) {
  const [taskDragOver, setTaskDragOver] = useState(false);
  return (
    <>
      {error && (
        <div className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
          <span>{copy.failed}</span>
          <button type="button" onClick={() => void onRetry()} className="font-semibold underline">
            {copy.retry}
          </button>
        </div>
      )}

      <section className="flex min-h-0 flex-1 flex-col gap-5">
        {/* Dispatched tasks — drop any chat bubble here to hand it to the AI
            planner, which works it with its tools and reports back. */}
        <DispatchedTasksSection
          copy={copy}
          tasks={dispatched}
          onDispatchBubble={onDispatchBubble}
        />

        {/* Grids — primary; also the drop target for agent-workable chat bubbles. */}
        <div
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(CHAT_TASK_DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setTaskDragOver(true);
          }}
          onDragLeave={() => setTaskDragOver(false)}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(CHAT_TASK_DRAG_TYPE);
            setTaskDragOver(false);
            if (!raw) return;
            e.preventDefault();
            try {
              onDropChatTask(JSON.parse(raw) as ChatTaskDragPayload);
            } catch {
              // Malformed payload — ignore the drop.
            }
          }}
          className={cn(
            "rounded-[var(--radius-md)] transition-[outline-color,background-color]",
            taskDragOver &&
              "bg-[var(--accent-line-soft)] outline-dashed outline-2 outline-[var(--accent-line)]",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] [font-family:var(--font-display)]">
              {copy.grids}
            </h3>
            <motion.button
              type="button"
              onClick={onAddGrid}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.95 }}
              transition={springSnappy}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)] hover:border-[var(--accent-line)] hover:text-[var(--text-primary)]"
            >
              <Plus className="h-3 w-3" aria-hidden />
              {copy.addGrid}
            </motion.button>
          </div>
          {grids === null ? (
            <SkeletonRows />
          ) : activeGrids.length === 0 ? (
            <p className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-hairline)] px-3 py-3 text-[11px] leading-snug text-[var(--text-muted)]">
              {copy.noGrids}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {activeGrids.map((g) => {
                const agent = agentByType.get(g.agentType);
                return (
                  <motion.li key={g.id} variants={springPop} initial="hidden" animate="show">
                    <RailRow onClick={() => onOpenGrid(g.id)} accent="decision">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm tracking-tight text-[var(--text-primary)] [font-family:var(--font-display)]">
                          {g.title}
                        </span>
                        <span className="block truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                          {agent?.label ?? g.agentType}
                        </span>
                      </span>
                    </RailRow>
                  </motion.li>
                );
              })}
            </ul>
          )}
        </div>

        {/* People — secondary. */}
        <details className="group" open>
          <summary className="mb-2 flex cursor-pointer list-none items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] [font-family:var(--font-display)]">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-3 w-3" aria-hidden />
              {copy.people}
            </span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
          </summary>

          <div className="space-y-4">
            <div>
              <h4 className="mb-1.5 text-[10px] font-medium text-[var(--text-faint)]">{copy.members}</h4>
              {members === null ? (
                <SkeletonRows />
              ) : otherMembers.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{copy.noMembers}</p>
              ) : (
                <ul className="space-y-0.5">
                  {otherMembers.map((m) => {
                    const count = m.appUserId ? unread.byMemberAppUserId[m.appUserId] ?? 0 : 0;
                    return (
                      <li key={m.lineUserId}>
                        <RailRow onClick={() => onOpenMember(m)} accent="line">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[var(--text-primary)]">
                              {m.displayName ?? "Unknown"}
                            </span>
                            <span className="block text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                              {m.role}
                            </span>
                          </span>
                          {count > 0 && <UnreadCount count={count} />}
                        </RailRow>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div>
              <h4 className="mb-1.5 text-[10px] font-medium text-[var(--text-faint)]">{copy.agents}</h4>
              {grids === null ? (
                <SkeletonRows />
              ) : activeGrids.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">{copy.noAgents}</p>
              ) : (
                <ul className="space-y-0.5">
                  {activeGrids.map((g) => {
                    const agent = agentByType.get(g.agentType);
                    const count = unread.byCustomGridId[g.id] ?? 0;
                    return (
                      <li key={g.id}>
                        <RailRow onClick={() => onOpenAgent(g)} accent="decision">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[var(--text-primary)]">{g.title}</span>
                            <span className="block truncate text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
                              {agent?.label ?? g.agentType}
                            </span>
                          </span>
                          {count > 0 && <UnreadCount count={count} />}
                        </RailRow>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </details>

        {/* Trip tools — links to the full feature pages, now that the chat
            room (not the bento) is the trip landing surface. */}
        <div>
          <h3 className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] [font-family:var(--font-display)]">
            <Wrench className="h-3 w-3" aria-hidden />
            {copy.tools}
          </h3>
          <ul className="space-y-0.5">
            {TOOL_LINKS.map((t) => (
              <li key={t.seg}>
                <Link
                  id={`trip-tool-${t.seg}`}
                  href={`/app/trips/${tripId}/${t.seg}`}
                  className="block truncate rounded-[var(--radius-md)] py-2 pl-3 pr-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-sunken)]"
                >
                  {copy[t.key]}
                </Link>
              </li>
            ))}
          </ul>
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

/**
 * A text-first rail row: no icon badge — just a hover background and a left
 * accent stripe that grows in on hover, keeping the rail clean and legible.
 */
function RailRow({
  onClick,
  accent,
  children,
}: {
  onClick: () => void;
  accent: "line" | "decision";
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.99 }}
      transition={springSnappy}
      className="group/row relative flex w-full items-center gap-2 rounded-[var(--radius-md)] py-2 pl-3 pr-2 text-left transition-colors hover:bg-[var(--surface-sunken)]"
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-0 w-[2px] -translate-y-1/2 rounded-full transition-all duration-200 group-hover/row:h-5",
          accent === "decision" ? "bg-[var(--status-needs-decision)]" : "bg-[var(--accent-line)]",
        )}
      />
      {children}
    </motion.button>
  );
}

function UnreadCount({ count }: { count: number }) {
  return (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-line)] px-1 text-[9px] font-semibold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * The "Dispatched tasks" drop zone + list. Dropping a chat bubble hands the
 * message to the AI planner; the list shows each task resolving (queued →
 * working → done/failed with the outcome line).
 */
function DispatchedTasksSection({
  copy,
  tasks,
  onDispatchBubble,
}: {
  copy: Copy;
  tasks: DispatchedTask[] | null;
  onDispatchBubble: (payload: ChatBubbleDragPayload) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const list = tasks ?? [];
  return (
    <div>
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] [font-family:var(--font-display)]">
        <Sparkles className="h-3 w-3" aria-hidden />
        {copy.dispatched}
      </h3>
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(CHAT_BUBBLE_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(CHAT_BUBBLE_DRAG_TYPE);
          setDragOver(false);
          if (!raw) return;
          e.preventDefault();
          try {
            onDispatchBubble(JSON.parse(raw) as ChatBubbleDragPayload);
          } catch {
            // Malformed payload — ignore the drop.
          }
        }}
        className={cn(
          "rounded-[var(--radius-md)] border border-dashed border-[var(--border-hairline)] p-1.5 transition-[border-color,background-color]",
          dragOver && "border-solid border-[var(--accent-line)] bg-[var(--accent-line-soft)]",
        )}
      >
        {list.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] leading-snug text-[var(--text-muted)]">
            {copy.dispatchedHint}
          </p>
        ) : (
          <ul className="space-y-1">
            {list.map((t) => (
              <DispatchedTaskRow key={t.id} copy={copy} task={t} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DispatchedTaskRow({ copy, task }: { copy: Copy; task: DispatchedTask }) {
  const active = task.status === "pending" || task.status === "running";
  const statusLine =
    task.status === "pending"
      ? copy.dispatchedQueued
      : task.status === "running"
        ? copy.dispatchedWorking
        : task.status === "done"
          ? task.summary || "Done"
          : task.summary || copy.dispatchedFailed;
  return (
    <li className="rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0" aria-hidden>
          {active ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-line)]" />
          ) : task.status === "done" ? (
            <Check className="h-3.5 w-3.5 text-[var(--status-settled)]" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-[var(--status-blocked)]" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12px] leading-snug text-[var(--text-primary)]">
            {task.text}
          </p>
          <p
            className={cn(
              "mt-0.5 line-clamp-2 text-[10px] leading-snug",
              task.status === "failed"
                ? "text-[var(--status-blocked)]"
                : "text-[var(--text-muted)]",
            )}
          >
            {statusLine}
          </p>
        </div>
      </div>
    </li>
  );
}

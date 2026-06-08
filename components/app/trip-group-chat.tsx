"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { springGentle } from "@/components/motion/variants";
import { appFetch, appFetchJson } from "@/lib/app-client";
import { useAppLocale } from "@/components/app/app-locale-provider";
import {
  GRIDS_CHANGED_EVENT,
  CHAT_TASK_DRAG_TYPE,
  CHAT_REORDER_DRAG_TYPE,
  CHAT_BUBBLE_DRAG_TYPE,
  CHAT_TASK_DISPATCHED_EVENT,
  type ChatTaskDragPayload,
  type ChatBubbleDragPayload,
  type ChatTaskDispatchedDetail,
} from "@/components/app/trip-workspace-events";
import type { ChatTaskClassification } from "@/app/api/app/trips/[tripId]/chat/classify/route";
import { ChatCanvas } from "@/components/app/chat/chat-canvas";
import { ChatBubble } from "@/components/app/chat/chat-bubble";
import { ChatComposer, type ComposerMode } from "@/components/app/chat/chat-composer";
import { ThinkingOrb } from "@/components/app/chat/thinking-orb";
import { ProposalCard3D } from "@/components/app/chat/proposal-card-3d";
import { useLiveMessageIds } from "@/components/app/chat/use-live-message-ids";
import type { AppLocale } from "@/lib/app-locale";
import type { AppMember } from "@/app/api/app/trips/[tripId]/members/route";
import type { PublicAgent } from "@/services/agents/registry";
import type { ChatThread } from "@/app/api/app/trips/[tripId]/chat/threads/route";
import type { ChatMessage } from "@/app/api/app/trips/[tripId]/chat/threads/[threadId]/messages/route";
import type {
  DispatchedTasksResponse,
  DispatchTaskResponse,
} from "@/app/api/app/trips/[tripId]/dispatched-tasks/route";

const COPY: Record<
  AppLocale,
  {
    room: string;
    roomSubtitle: string;
    you: string;
    orchestrator: string;
    empty: string;
    emptyHint: string;
    placeholder: string;
    taskPlaceholder: string;
    modeMessage: string;
    modeTask: string;
    send: string;
    sending: string;
    thinking: string;
    thinkingPhrases: string[];
    failed: string;
    retry: string;
    proposalEyebrow: string;
    add: string;
    dismiss: string;
    adding: string;
    dispatched: string;
    proposalFallback: (title: string) => string;
  }
> = {
  en: {
    room: "Trip chat",
    roomSubtitle: "Everyone + your AI planner",
    you: "You",
    orchestrator: "AI planner",
    empty: "This is the start of your trip chat.",
    emptyHint:
      "Talk through the trip here. Your AI planner is listening and will suggest grids when it spots something to track.",
    placeholder: "Message the group…",
    taskPlaceholder: "Describe a task for the AI planner…",
    modeMessage: "Message",
    modeTask: "Task",
    send: "Send",
    sending: "…",
    thinking: "AI planner is reading the chat…",
    thinkingPhrases: [
      "Reading the conversation…",
      "Picking out what to track…",
      "Scanning dates & places…",
      "Drafting a suggestion…",
    ],
    failed: "Something went wrong",
    retry: "Retry",
    proposalEyebrow: "AI planner suggests a grid",
    add: "Add grid",
    dismiss: "Not now",
    adding: "Adding…",
    dispatched: "Dispatched",
    proposalFallback: (title) => `Add a “${title}” grid to track this for the trip?`,
  },
  "zh-TW": {
    room: "旅程聊天",
    roomSubtitle: "所有成員 + AI 規劃助手",
    you: "你",
    orchestrator: "AI 規劃助手",
    empty: "這是旅程聊天的開始。",
    emptyHint:
      "在這裡討論旅程。AI 規劃助手會聆聽對話，並在發現值得追蹤的事項時建議格子。",
    placeholder: "傳訊息給群組…",
    taskPlaceholder: "描述要交給 AI 規劃助手的任務…",
    modeMessage: "訊息",
    modeTask: "任務",
    send: "送出",
    sending: "…",
    thinking: "AI 規劃助手正在閱讀對話…",
    thinkingPhrases: [
      "正在閱讀對話…",
      "找出值得追蹤的事項…",
      "掃描日期與地點…",
      "草擬建議中…",
    ],
    failed: "發生錯誤",
    retry: "重試",
    proposalEyebrow: "AI 規劃助手建議新增格子",
    add: "新增格子",
    dismiss: "暫時不要",
    adding: "新增中…",
    dispatched: "已派發",
    proposalFallback: (title) => `要為旅程新增「${title}」格子來追蹤嗎？`,
  },
};

type StreamEvent =
  | { type: "hello"; threadId: string }
  | { type: "ping" }
  | { type: "message"; message: ChatMessage }
  | { type: "read"; read: { appUserId: string; lastReadAt: string } };

interface OrchestratorAction {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  rationale: string | null;
  status: string;
  createdAt: string;
}

interface OrchestratorResponse {
  orchestrator: { pendingReason: string | null };
  actions: OrchestratorAction[];
}

const PROPOSAL_POLL_MS = 8_000;
const THINKING_WINDOW_MS = 25_000;

/**
 * The trip workspace's primary surface: a shared group chat room for every
 * member, with the AI planner (per-trip orchestrator) participating. Member
 * messages wake the orchestrator server-side; when it proposes a bento grid
 * (a propose-only `grids.add_agent` action) the proposal surfaces here as an
 * inline confirm/dismiss card. Confirming creates the grid, which then appears
 * in the right rail (we broadcast `GRIDS_CHANGED_EVENT` so the rail refetches).
 */
export function TripGroupChat({
  tripId,
  currentAppUserId,
}: {
  tripId: string;
  currentAppUserId: string | null;
}) {
  const { locale } = useAppLocale();
  const copy = COPY[locale];

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<AppMember[]>([]);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [proposals, setProposals] = useState<OrchestratorAction[]>([]);
  const [draft, setDraft] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>("message");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingUntil, setThinkingUntil] = useState(0);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Per-message "agent-workable" verdicts; "pending" while the classify call
  // is in flight. A bubble is draggable only once its verdict says workable.
  const [tasks, setTasks] = useState<Record<string, ChatTaskClassification | "pending">>({});
  const inspectedRef = useRef<Set<string>>(new Set());
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Which bubble is "focused" (selected). One at a time; cleared on Esc / click-away.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Client-side display order so reordering bubbles doesn't fight the server
  // feed: ids the server sends are appended in arrival order, but the user can
  // rearrange them locally (this session only — the reorder isn't persisted).
  const [order, setOrder] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: "before" | "after" } | null>(null);
  // Inner-bubble elements, keyed by message id, so arrow keys can move focus.
  const bubbleRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Message ids already dispatched to the AI planner — highlighted and locked
  // from dragging. Seeded from the server, kept live via the dispatched event.
  const [dispatchedIds, setDispatchedIds] = useState<Set<string>>(() => new Set());

  // Lazily classify a message the first time its bubble is hovered/focused.
  const inspect = useCallback(
    (messageId: string, content: string) => {
      if (content.trim().length < 3 || inspectedRef.current.has(messageId)) return;
      inspectedRef.current.add(messageId);
      setTasks((cur) => ({ ...cur, [messageId]: "pending" }));
      void (async () => {
        try {
          const res = await appFetchJson<{ classification: ChatTaskClassification }>(
            `/api/app/trips/${tripId}/chat/classify`,
            { method: "POST", body: JSON.stringify({ messageId }) },
          );
          setTasks((cur) => ({ ...cur, [messageId]: res.classification }));
        } catch {
          // Allow a retry on the next hover; drop the pending marker.
          inspectedRef.current.delete(messageId);
          setTasks((cur) => {
            const next = { ...cur };
            delete next[messageId];
            return next;
          });
        }
      })();
    },
    [tripId],
  );

  const memberByAppUserId = useMemo(() => {
    const m = new Map<string, AppMember>();
    for (const member of members) {
      if (member.appUserId) m.set(member.appUserId, member);
    }
    return m;
  }, [members]);

  const agentByType = useMemo(
    () => new Map(agents.map((a) => [a.type, a])),
    [agents],
  );

  // Which messages arrived live this session — only those AI messages stream.
  const liveIds = useLiveMessageIds(messages);

  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  // The messages to render, in display order. `order` is authoritative (so a
  // user reorder sticks), but any message not yet folded in by the sync effect
  // below — including the very first batch — falls back to arrival order so the
  // list never flashes empty for a frame.
  const orderedMessages = useMemo(() => {
    const seen = new Set<string>();
    const out: ChatMessage[] = [];
    for (const id of order) {
      const m = messageById.get(id);
      if (m) {
        out.push(m);
        seen.add(id);
      }
    }
    for (const m of messages) if (!seen.has(m.id)) out.push(m);
    return out;
  }, [order, messages, messageById]);

  // Keep the display order in sync with the server feed: new ids append in
  // arrival order, dropped ids fall out, and any user reordering is preserved.
  useEffect(() => {
    setOrder((prev) => {
      const present = new Set(messages.map((m) => m.id));
      const kept = prev.filter((id) => present.has(id));
      const keptSet = new Set(kept);
      const appended = messages.filter((m) => !keptSet.has(m.id)).map((m) => m.id);
      const next = [...kept, ...appended];
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [messages]);

  // Drop the selection if its message goes away (e.g. an optimistic message
  // reconciled under a different id).
  useEffect(() => {
    if (focusedId && !messageById.has(focusedId)) setFocusedId(null);
  }, [focusedId, messageById]);

  // Move a bubble before/after another within the local order.
  const moveMessage = useCallback(
    (fromId: string, targetId: string, place: "before" | "after") => {
      if (fromId === targetId) return;
      setOrder((prev) => {
        const without = prev.filter((id) => id !== fromId);
        const idx = without.indexOf(targetId);
        if (idx === -1) return prev;
        without.splice(place === "before" ? idx : idx + 1, 0, fromId);
        return without;
      });
    },
    [],
  );

  // Arrow-key navigation: move DOM focus to the neighbouring bubble (its own
  // onFocus then selects it); Escape clears the selection.
  const moveFocus = useCallback(
    (fromId: string, dir: "up" | "down" | "escape") => {
      if (dir === "escape") {
        setFocusedId(null);
        bubbleRefs.current.get(fromId)?.blur();
        return;
      }
      const idx = order.indexOf(fromId);
      const nextId = dir === "down" ? order[idx + 1] : order[idx - 1];
      if (nextId) bubbleRefs.current.get(nextId)?.focus();
    },
    [order],
  );

  // Seed dispatched-message ids from the server (so a reload still shows which
  // bubbles were handed off) and stay live via the rail's dispatch event.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await appFetchJson<DispatchedTasksResponse>(
          `/api/app/trips/${tripId}/dispatched-tasks`,
        );
        if (cancelled) return;
        const ids = res.tasks
          .map((t) => t.messageId)
          .filter((id): id is string => !!id);
        setDispatchedIds(new Set(ids));
      } catch {
        // Non-critical — the dispatch event still marks new ones this session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId } = (e as CustomEvent<ChatTaskDispatchedDetail>).detail ?? {};
      if (!messageId) return;
      setDispatchedIds((prev) => (prev.has(messageId) ? prev : new Set(prev).add(messageId)));
    };
    window.addEventListener(CHAT_TASK_DISPATCHED_EVENT, handler);
    return () => window.removeEventListener(CHAT_TASK_DISPATCHED_EVENT, handler);
  }, []);

  const markRead = useCallback(
    async (threadId: string) => {
      try {
        await appFetch(`/api/app/trips/${tripId}/chat/threads/${threadId}/read`, {
          method: "POST",
        });
      } catch {
        // Read state is non-critical for the always-open group room.
      }
    },
    [tripId],
  );

  // Open the singleton group thread + load history, members, and agents.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [{ thread: t }, mem, ag] = await Promise.all([
          appFetchJson<{ thread: ChatThread }>(`/api/app/trips/${tripId}/chat/threads`, {
            method: "POST",
            body: JSON.stringify({ kind: "group" }),
          }),
          appFetchJson<{ members: AppMember[] }>(`/api/app/trips/${tripId}/members`),
          appFetchJson<{ agents: PublicAgent[] }>(`/api/app/agents`),
        ]);
        if (cancelled) return;
        setThread(t);
        setMembers(mem.members);
        setAgents(ag.agents);
        const initial = await appFetchJson<{ messages: ChatMessage[] }>(
          `/api/app/trips/${tripId}/chat/threads/${t.id}/messages`,
        );
        if (cancelled) return;
        setMessages(initial.messages);
        void markRead(t.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load chat");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, markRead]);

  // Realtime relay for new messages.
  useEffect(() => {
    if (!thread) return;
    const source = new EventSource(
      `/api/app/trips/${tripId}/chat/threads/${thread.id}/stream`,
      { withCredentials: true },
    );
    source.onmessage = (ev: MessageEvent<string>) => {
      let payload: StreamEvent;
      try {
        payload = JSON.parse(ev.data) as StreamEvent;
      } catch {
        return;
      }
      if (payload.type === "message") {
        setMessages((prev) =>
          prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message],
        );
        if (payload.message.senderAppUserId !== currentAppUserId) void markRead(thread.id);
      }
    };
    return () => source.close();
  }, [thread, tripId, currentAppUserId, markRead]);

  // Poll the orchestrator for pending grid proposals + the "thinking" pulse.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      if (cancelled) return;
      try {
        const res = await appFetchJson<OrchestratorResponse>(
          `/api/app/trips/${tripId}/orchestrator`,
        );
        if (cancelled) return;
        const pending = res.actions.filter(
          (a) => a.status === "pending" && a.tool === "grids.add_agent",
        );
        setProposals(pending);
        if (pending.length > 0) setThinkingUntil(0);
      } catch {
        // Transient — keep polling.
      }
      if (!cancelled) timer = setTimeout(tick, PROPOSAL_POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tripId]);

  // Tick a clock while "thinking" so the indicator clears itself.
  useEffect(() => {
    if (thinkingUntil <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [thinkingUntil, now]);

  // Keep pinned to the latest message / proposal.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, proposals]);

  const send = useCallback(
    async (content: string, asTask: boolean) => {
      if (!thread || !content.trim() || !currentAppUserId) return;
      setSending(true);
      setError(null);
      try {
        const res = await appFetchJson<{ message: ChatMessage }>(
          `/api/app/trips/${tripId}/chat/threads/${thread.id}/messages`,
          { method: "POST", body: JSON.stringify({ content }) },
        );
        setMessages((prev) =>
          prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
        );
        setDraft("");
        // We just woke the orchestrator — show the pulse until a proposal lands
        // or the window elapses.
        setThinkingUntil(Date.now() + THINKING_WINDOW_MS);
        setNow(Date.now());

        // Task mode: the message is also dispatched to the AI planner. Mark its
        // bubble dispatched (highlight + drag lock) and tell the rail to refresh.
        if (asTask) {
          try {
            await appFetchJson<DispatchTaskResponse>(
              `/api/app/trips/${tripId}/dispatched-tasks`,
              {
                method: "POST",
                body: JSON.stringify({ text: content, messageId: res.message.id }),
              },
            );
            const dispatchedId = res.message.id;
            setDispatchedIds((prev) => new Set(prev).add(dispatchedId));
            window.dispatchEvent(
              new CustomEvent<ChatTaskDispatchedDetail>(CHAT_TASK_DISPATCHED_EVENT, {
                detail: { messageId: dispatchedId },
              }),
            );
          } catch (err) {
            // The message still posted; only the dispatch failed.
            setError(err instanceof Error ? err.message : "Failed to dispatch task");
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send");
      } finally {
        setSending(false);
      }
    },
    [thread, tripId, currentAppUserId],
  );

  const decide = useCallback(
    async (actionId: string, decision: "confirm" | "dismiss") => {
      setDeciding(actionId);
      // Optimistically drop the card.
      setProposals((prev) => prev.filter((p) => p.id !== actionId));
      try {
        await appFetch(`/api/app/trips/${tripId}/orchestrator/actions/${actionId}`, {
          method: "POST",
          body: JSON.stringify({ decision }),
        });
        if (decision === "confirm") {
          // The grid now exists — tell the rail to refetch.
          window.dispatchEvent(new CustomEvent(GRIDS_CHANGED_EVENT));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      } finally {
        setDeciding(null);
      }
    },
    [tripId],
  );

  const thinking = thinkingUntil > now && proposals.length === 0;

  return (
    <div className="-mx-4 -mb-6 flex h-[calc(100dvh-9rem)] min-h-[460px] flex-col overflow-hidden bg-[var(--surface-base)] sm:-mx-6 sm:-mb-8 lg:-mx-8 2xl:-mx-10">
      <ChatCanvas scrollerRef={scrollerRef}>
        {loading && messages.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-12 rounded-[var(--radius-md)]" />
            ))}
          </div>
        ) : messages.length === 0 && proposals.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springGentle}
            className="flex h-full flex-col items-center justify-center px-6 text-center"
          >
            <span aria-hidden className="gc-orb mb-4 !h-7 !w-7" />
            <p className="text-base font-semibold tracking-tight text-[var(--text-primary)] [font-family:var(--font-display)]">
              {copy.empty}
            </p>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">{copy.emptyHint}</p>
          </motion.div>
        ) : (
          // Click-away (the gaps between bubbles) clears the selection; bubble
          // clicks stopPropagation so they don't bubble up to this handler.
          <ul className="space-y-3.5" onClick={() => setFocusedId(null)}>
            <AnimatePresence initial={false}>
              {orderedMessages.map((m) => {
                const mine = m.senderAppUserId === currentAppUserId;
                const isAgent = m.senderKind === "agent";
                const member = m.senderAppUserId
                  ? memberByAppUserId.get(m.senderAppUserId)
                  : undefined;
                const author = isAgent
                  ? copy.orchestrator
                  : mine
                    ? copy.you
                    : member?.displayName || copy.you;

                // Only human messages are classified; the AI planner's own
                // prose isn't a task to hand back to it.
                const verdict = tasks[m.id];
                const cls = verdict && verdict !== "pending" ? verdict : null;
                const workable = !isAgent && !!cls && cls.workable && !!cls.agentType;
                const taskAgent = workable ? agentByType.get(cls!.agentType!) : undefined;
                const isDispatched = dispatchedIds.has(m.id);

                // Drop placement: top half of the target = before, else after.
                const placeFromEvent = (e: React.DragEvent<HTMLLIElement>): "before" | "after" => {
                  const r = e.currentTarget.getBoundingClientRect();
                  return e.clientY < r.top + r.height / 2 ? "before" : "after";
                };

                return (
                  <ChatBubble
                    key={m.id}
                    role={isAgent ? "agent" : mine ? "mine" : "member"}
                    content={m.content}
                    author={author}
                    avatarUrl={isAgent ? null : member?.avatarUrl}
                    avatarLabel={member?.displayName || author}
                    stream={isAgent && liveIds.has(m.id)}
                    focused={focusedId === m.id}
                    dragging={dragId === m.id}
                    dropIndicator={dropTarget?.id === m.id ? dropTarget.place : null}
                    dispatched={isDispatched}
                    dispatchedLabel={copy.dispatched}
                    onInspect={isAgent ? undefined : () => inspect(m.id, m.content)}
                    onSelect={() => setFocusedId(m.id)}
                    onKeyNav={(dir) => moveFocus(m.id, dir)}
                    registerRef={(el) => {
                      if (el) bubbleRefs.current.set(m.id, el);
                      else bubbleRefs.current.delete(m.id);
                    }}
                    task={
                      workable
                        ? { label: taskAgent?.label ?? cls!.title, icon: taskAgent?.icon }
                        : null
                    }
                    draggable={!isDispatched}
                    onDragStart={(e) => {
                      setDragId(m.id);
                      // Always carry the reorder marker (in-chat) and the
                      // generic bubble payload (rail's "Dispatched tasks" drop
                      // zone). Workable bubbles also carry the grids-rail
                      // payload — the drop target decides which it understands.
                      e.dataTransfer.setData(CHAT_REORDER_DRAG_TYPE, m.id);
                      const bubblePayload: ChatBubbleDragPayload = {
                        messageId: m.id,
                        text: m.content,
                      };
                      e.dataTransfer.setData(CHAT_BUBBLE_DRAG_TYPE, JSON.stringify(bubblePayload));
                      if (workable) {
                        const payload: ChatTaskDragPayload = {
                          messageId: m.id,
                          agentType: cls!.agentType!,
                          title: cls!.title || taskAgent?.label || "Grid",
                          config: cls!.config,
                        };
                        e.dataTransfer.setData(CHAT_TASK_DRAG_TYPE, JSON.stringify(payload));
                      }
                      e.dataTransfer.effectAllowed = "copyMove";
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setDropTarget(null);
                    }}
                    onReorderOver={(e) => {
                      if (!dragId || dragId === m.id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const place = placeFromEvent(e);
                      setDropTarget((cur) =>
                        cur?.id === m.id && cur.place === place ? cur : { id: m.id, place },
                      );
                    }}
                    onReorderDrop={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      moveMessage(dragId, m.id, placeFromEvent(e));
                      setDragId(null);
                      setDropTarget(null);
                    }}
                  />
                );
              })}

              {proposals.map((p) => {
                const agentType = String(p.input.agentType ?? "");
                const agent = agentByType.get(agentType);
                const title = String(p.input.title ?? agent?.label ?? agentType);
                return (
                  <li key={p.id}>
                    <ProposalCard3D
                      eyebrow={copy.proposalEyebrow}
                      title={title}
                      subtitle={agent?.label ?? agentType}
                      rationale={p.rationale?.trim() || copy.proposalFallback(title)}
                      icon={agent?.icon}
                      confirmLabel={deciding === p.id ? copy.adding : copy.add}
                      dismissLabel={copy.dismiss}
                      deciding={deciding === p.id}
                      onConfirm={() => void decide(p.id, "confirm")}
                      onDismiss={() => void decide(p.id, "dismiss")}
                    />
                  </li>
                );
              })}

              {thinking && (
                <ThinkingOrb key="thinking" phrases={copy.thinkingPhrases} label={copy.thinking} />
              )}
            </AnimatePresence>
          </ul>
        )}
      </ChatCanvas>

      {error && (
        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] bg-[var(--status-blocked-soft)] px-4 py-2 text-xs text-[var(--status-blocked)]">
          <span>{copy.failed}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold underline">
            {copy.retry}
          </button>
        </div>
      )}

      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => void send(draft, composerMode === "task")}
        placeholder={copy.placeholder}
        taskPlaceholder={copy.taskPlaceholder}
        mode={composerMode}
        onModeChange={setComposerMode}
        messageLabel={copy.modeMessage}
        taskLabel={copy.modeTask}
        disabled={!thread || !currentAppUserId}
        sending={sending}
      />
    </div>
  );
}

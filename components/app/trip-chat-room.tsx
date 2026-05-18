"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { appFetch, appFetchJson } from "@/lib/app-client";
import { cn } from "@/lib/utils";
import type { ChatThread } from "@/app/api/app/trips/[tripId]/chat/threads/route";
import type { ChatMessage } from "@/app/api/app/trips/[tripId]/chat/threads/[threadId]/messages/route";

type OpenRequest =
  | { kind: "member_dm"; targetAppUserId: string }
  | { kind: "agent"; customGridId: string };

interface TripChatRoomProps {
  tripId: string;
  currentAppUserId: string;
  open: boolean;
  onClose: () => void;
  target: {
    title: string;
    subtitle: string | null;
    avatarLabel: string;
    icon?: string;
    request: OpenRequest;
  } | null;
  /** Fires when the caller marks a thread as read; lets the navbar refresh. */
  onMarkedRead?: () => void;
}

type StreamEvent =
  | { type: "hello"; threadId: string }
  | { type: "ping" }
  | { type: "message"; message: ChatMessage }
  | { type: "read"; read: { appUserId: string; lastReadAt: string } };

export function TripChatRoom({
  tripId,
  currentAppUserId,
  open,
  onClose,
  target,
  onMarkedRead,
}: TripChatRoomProps) {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const markRead = useCallback(
    async (threadId: string) => {
      try {
        const res = await appFetch(
          `/api/app/trips/${tripId}/chat/threads/${threadId}/read`,
          { method: "POST" },
        );
        if (res.ok) {
          const { lastReadAt } = (await res.json()) as { lastReadAt: string };
          setReads((prev) => ({ ...prev, [currentAppUserId]: lastReadAt }));
          onMarkedRead?.();
        }
      } catch {
        // Silent — read state is non-critical; next call will retry.
      }
    },
    [tripId, currentAppUserId, onMarkedRead],
  );

  // Open or find the thread whenever the target changes. Mark as read on open.
  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    setReads({});
    setThread(null);
    setDraft("");

    void (async () => {
      try {
        const { thread: t } = await appFetchJson<{ thread: ChatThread }>(
          `/api/app/trips/${tripId}/chat/threads`,
          { method: "POST", body: JSON.stringify(target.request) },
        );
        if (cancelled) return;
        setThread(t);
        const initial = await appFetchJson<{
          messages: ChatMessage[];
          reads: Record<string, string>;
        }>(`/api/app/trips/${tripId}/chat/threads/${t.id}/messages`);
        if (cancelled) return;
        setMessages(initial.messages);
        setReads(initial.reads);
        await markRead(t.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to open chat");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, target, tripId, markRead]);

  // Subscribe to the server-side SSE relay for realtime message + read events.
  useEffect(() => {
    if (!open || !thread) return;
    const url = `/api/app/trips/${tripId}/chat/threads/${thread.id}/stream`;
    const source = new EventSource(url, { withCredentials: true });

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
        // If a remote party sent it, mark the thread as read immediately
        // since the dialog is in the foreground.
        if (
          payload.message.senderKind === "agent" ||
          payload.message.senderAppUserId !== currentAppUserId
        ) {
          void markRead(thread.id);
        }
      } else if (payload.type === "read") {
        setReads((prev) => ({ ...prev, [payload.read.appUserId]: payload.read.lastReadAt }));
      }
    };

    return () => {
      source.close();
    };
  }, [open, thread, tripId, currentAppUserId, markRead]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(
    async (content: string) => {
      if (!thread || !content.trim()) return;
      setSending(true);
      setError(null);
      try {
        const res = await appFetchJson<{
          message: ChatMessage;
          agentMessage: ChatMessage | null;
        }>(`/api/app/trips/${tripId}/chat/threads/${thread.id}/messages`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        setMessages((prev) => {
          // Server-sent realtime may have already delivered these.
          const seen = new Set(prev.map((m) => m.id));
          const next = [...prev];
          if (!seen.has(res.message.id)) next.push(res.message);
          if (res.agentMessage && !seen.has(res.agentMessage.id)) next.push(res.agentMessage);
          return next;
        });
        setDraft("");
        await markRead(thread.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send");
      } finally {
        setSending(false);
      }
    },
    [thread, tripId, markRead],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }

  // Find the index of my last outgoing message — that's where the "Read"
  // indicator goes (DMs only).
  const isDm = thread?.kind === "member_dm";
  const otherAppUserId = isDm
    ? thread.memberAppUserIdLo === currentAppUserId
      ? thread.memberAppUserIdHi
      : thread.memberAppUserIdLo
    : null;
  const otherLastReadAt = otherAppUserId ? reads[otherAppUserId] : undefined;
  let lastMineIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderAppUserId === currentAppUserId) {
      lastMineIndex = i;
      break;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[80vh] max-h-[680px] w-[95vw] max-w-md flex-col gap-0 p-0">
        <DialogHeader className="flex flex-row items-center gap-3 border-b border-[var(--border-hairline)] p-4">
          <span
            aria-hidden
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              target?.request.kind === "agent"
                ? "bg-[var(--status-needs-decision-soft)] text-[var(--status-needs-decision)]"
                : "bg-[var(--accent-line-soft)] text-[var(--accent-line)]",
            )}
          >
            {target?.icon ?? target?.avatarLabel.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 text-left">
            <DialogTitle className="truncate text-sm font-semibold">
              {target?.title ?? ""}
            </DialogTitle>
            {target?.subtitle && (
              <p className="truncate text-[11px] text-[var(--text-muted)]">
                {target.subtitle}
              </p>
            )}
          </div>
        </DialogHeader>

        <div
          ref={scrollerRef}
          className="flex-1 overflow-y-auto px-4 py-3"
          aria-live="polite"
        >
          {loading && messages.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-10 rounded-[var(--radius-md)]" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-xs text-[var(--text-muted)]">
              {target?.request.kind === "agent"
                ? "No conversation yet. Say hi to the agent."
                : "No messages yet. Start the conversation."}
            </p>
          ) : (
            <ul className="space-y-2">
              {messages.map((m, idx) => {
                const mine = m.senderAppUserId === currentAppUserId;
                const showReadReceipt =
                  isDm &&
                  mine &&
                  idx === lastMineIndex &&
                  otherLastReadAt !== undefined &&
                  otherLastReadAt >= m.createdAt;
                return (
                  <li
                    key={m.id}
                    className={cn(
                      "flex flex-col",
                      mine ? "items-end" : "items-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-[var(--radius-md)] px-3 py-2 text-sm",
                        mine
                          ? "bg-[var(--accent-line)] text-white"
                          : m.senderKind === "agent"
                            ? "bg-[var(--status-needs-decision-soft)] text-[var(--text-primary)]"
                            : "bg-[var(--surface-sunken)] text-[var(--text-primary)]",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    </div>
                    {showReadReceipt && (
                      <span className="mt-0.5 text-[10px] text-[var(--text-faint)]">
                        Read
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p className="border-t border-[var(--border-hairline)] bg-[var(--status-blocked-soft)] px-4 py-2 text-xs text-[var(--status-blocked)]">
            {error}
          </p>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 border-t border-[var(--border-hairline)] p-3"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            rows={2}
            disabled={!thread || sending}
            placeholder={
              target?.request.kind === "agent"
                ? "Ask the agent something…"
                : "Type a message…"
            }
            className="flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border-hairline)] bg-[var(--surface-base)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]"
          />
          <Button type="submit" disabled={!thread || sending || !draft.trim()}>
            {sending ? "…" : "Send"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

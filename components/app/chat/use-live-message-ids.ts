"use client";

/**
 * Tracks which message ids appeared *after* the first non-empty render, i.e.
 * arrived live during this session rather than loading as history. The chat
 * surfaces use this to stream (typewrite) only newly-arrived AI messages while
 * rendering history instantly — so opening a busy thread isn't a slow crawl.
 */

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/app/api/app/trips/[tripId]/chat/threads/[threadId]/messages/route";

export function useLiveMessageIds(messages: ChatMessage[]): Set<string> {
  // Ids present at the first non-empty render are "history" and never stream.
  const historyRef = useRef<Set<string> | null>(null);
  const [liveIds, setLiveIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (historyRef.current === null) {
      if (messages.length === 0) return; // wait for the first batch
      historyRef.current = new Set(messages.map((m) => m.id));
      return;
    }
    const history = historyRef.current;
    setLiveIds((prev) => {
      let next: Set<string> | null = null;
      for (const m of messages) {
        if (!history.has(m.id) && !prev.has(m.id)) {
          next ??= new Set(prev);
          next.add(m.id);
        }
      }
      return next ?? prev;
    });
  }, [messages]);

  return liveIds;
}

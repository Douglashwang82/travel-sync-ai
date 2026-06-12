'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ReasoningScene — phase 3 of the index-page survey pipeline.
//
// Opens the SSE stream from POST /api/home/itinerary and performs the agent's
// reasoning live: a breathing aurora core, the visitor's picks orbiting in as
// chips, a five-step pipeline checklist and a streaming thought console. The
// server streams faster than a human can read, so events are buffered and
// played back with a minimum dwell per beat; the finished itinerary is handed
// to the parent once the choreography catches up.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Check, ChevronLeft, Layers, Loader2, RefreshCw, Route, Search, Sparkles, Wallet } from "lucide-react";
import {
  getHomePoi,
  type HomeCountry,
  type HomeItinerary,
  type HomeReasoningStepEvent,
  type HomeReasoningStepId,
} from "@/lib/home-survey";
import { springSnappy } from "@/components/motion/variants";

type StreamEvent =
  | { kind: "step"; step: HomeReasoningStepEvent }
  | { kind: "thought"; text: string }
  | { kind: "itinerary"; itinerary: HomeItinerary }
  | { kind: "error"; message: string }
  | { kind: "done" };

interface StepState {
  status: "pending" | "running" | "done" | "fallback";
  detail: string;
}

const STEP_ORDER: HomeReasoningStepId[] = ["analyze", "cluster", "plan", "solve", "cost"];

const STEP_META: Record<HomeReasoningStepId, { icon: typeof Search; en: string; zh: string }> = {
  analyze: { icon: Search, en: "Analyze picks", zh: "分析選點" },
  cluster: { icon: Layers, en: "Cluster into days", zh: "分群排天" },
  plan: { icon: Sparkles, en: "AI day planning", zh: "AI 規劃" },
  solve: { icon: Route, en: "Route & timing", zh: "動線與時間" },
  cost: { icon: Wallet, en: "Cost estimate", zh: "花費估算" },
};

interface ReasoningSceneProps {
  country: HomeCountry;
  locale: "en" | "zh-TW";
  poiIds: string[];
  onComplete: (itinerary: HomeItinerary) => void;
  onBack: () => void;
}

export default function ReasoningScene({ country, locale, poiIds, onComplete, onBack }: ReasoningSceneProps) {
  const zh = locale === "zh-TW";
  const [steps, setSteps] = useState<Record<HomeReasoningStepId, StepState>>(() =>
    Object.fromEntries(STEP_ORDER.map((id) => [id, { status: "pending", detail: "" }])) as Record<HomeReasoningStepId, StepState>,
  );
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const consoleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const queue: StreamEvent[] = [];
    let streamClosed = false;
    let itinerary: HomeItinerary | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // Reset visual state for retries.
    setSteps(Object.fromEntries(STEP_ORDER.map((id) => [id, { status: "pending", detail: "" }])) as Record<HomeReasoningStepId, StepState>);
    setThoughts([]);
    setError(null);

    const apply = (ev: StreamEvent) => {
      if (ev.kind === "step") {
        setSteps((prev) => ({
          ...prev,
          [ev.step.id]: {
            status: ev.step.status === "start" ? "running" : ev.step.status,
            detail: ev.step.detail,
          },
        }));
      } else if (ev.kind === "thought") {
        setThoughts((prev) => [...prev, ev.text]);
      } else if (ev.kind === "itinerary") {
        itinerary = ev.itinerary;
      } else if (ev.kind === "error" && !itinerary) {
        setError(ev.message);
      }
    };

    const playNext = () => {
      if (cancelled) return;
      const ev = queue.shift();
      if (!ev) {
        if (streamClosed) {
          if (itinerary) {
            const result = itinerary;
            timer = setTimeout(() => !cancelled && onComplete(result), 900);
          } else if (!error) {
            setError(zh ? "連線中斷了。" : "The stream was interrupted.");
          }
          return;
        }
        timer = setTimeout(playNext, 180);
        return;
      }
      apply(ev);
      const dwell = ev.kind === "thought" ? 1050 : ev.kind === "step" ? 420 : 80;
      timer = setTimeout(playNext, dwell);
    };

    const run = async () => {
      try {
        const res = await fetch("/api/home/itinerary", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ country: country.code, poiIds, locale }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const eventLine = raw.match(/^event: (.+)$/m)?.[1];
            const dataLine = raw.match(/^data: (.+)$/m)?.[1];
            if (!eventLine || !dataLine) continue;
            try {
              const data = JSON.parse(dataLine);
              if (eventLine === "step") queue.push({ kind: "step", step: data });
              else if (eventLine === "thought") queue.push({ kind: "thought", text: data.text });
              else if (eventLine === "itinerary") queue.push({ kind: "itinerary", itinerary: data });
              else if (eventLine === "error") queue.push({ kind: "error", message: data.message });
              else if (eventLine === "done") queue.push({ kind: "done" });
            } catch {
              // skip malformed frame
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          queue.push({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        streamClosed = true;
      }
    };

    void run();
    playNext();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rerun only on explicit retry
  }, [attempt]);

  // Keep the thought console pinned to the latest line.
  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: "smooth" });
  }, [thoughts]);

  return (
    <div id="home-reasoning-scene" className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      {/* Agent core + the visitor's picks feeding into it */}
      <div id="home-reasoning-core" className="relative mx-auto mb-8 flex flex-col items-center">
        <div id="home-reasoning-orb-wrap" className="relative grid h-24 w-24 place-items-center">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-line)]/15 [animation-duration:2.2s]" />
          <span aria-hidden className="absolute inset-3 animate-ping rounded-full bg-[var(--accent-cool)]/15 [animation-duration:2.2s] [animation-delay:0.5s]" />
          <span
            id="home-reasoning-orb"
            className="gc-orb relative !h-14 !w-14"
            style={{ flexBasis: "3.5rem" }}
            aria-hidden
          />
        </div>
        <div id="home-reasoning-chips" className="mt-4 flex max-w-md flex-wrap justify-center gap-1.5">
          {poiIds.map((id, i) => {
            const poi = getHomePoi(id);
            if (!poi) return null;
            return (
              <motion.span
                key={id}
                id={`home-reasoning-chip-${id}`}
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: [0.45, 1, 0.45], y: 0, scale: 1 }}
                transition={{
                  opacity: { repeat: Infinity, duration: 2.4, delay: i * 0.25 },
                  y: springSnappy,
                  scale: springSnappy,
                }}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2.5 py-1 text-[11px] font-semibold"
              >
                <span aria-hidden>{poi.emoji}</span>
                {zh ? poi.nameZh : poi.name}
              </motion.span>
            );
          })}
        </div>
      </div>

      <div id="home-reasoning-panels" className="grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
        {/* Pipeline checklist */}
        <ol id="home-reasoning-steps" className="surface-tile-raised space-y-1 p-3">
          {STEP_ORDER.map((id) => {
            const meta = STEP_META[id];
            const state = steps[id];
            const Icon = meta.icon;
            return (
              <li
                key={id}
                id={`home-reasoning-step-${id}`}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-300 ${
                  state.status === "running" ? "bg-[var(--accent-line-soft)]" : ""
                }`}
              >
                <span
                  id={`home-reasoning-step-icon-${id}`}
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${
                    state.status === "done"
                      ? "border-transparent bg-[var(--accent-line)] text-white"
                      : state.status === "fallback"
                        ? "border-transparent bg-[var(--status-needs-decision)] text-white"
                        : state.status === "running"
                          ? "border-[var(--accent-line)] text-[var(--accent-line)]"
                          : "border-[var(--border-hairline)] text-[var(--text-faint)]"
                  }`}
                >
                  {state.status === "done" || state.status === "fallback" ? (
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                  ) : state.status === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Icon className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <span id={`home-reasoning-step-text-${id}`} className="min-w-0">
                  <span
                    id={`home-reasoning-step-title-${id}`}
                    className={`block text-[13.5px] font-semibold ${state.status === "pending" ? "text-[var(--text-faint)]" : ""}`}
                  >
                    {zh ? meta.zh : meta.en}
                  </span>
                  {state.detail && (
                    <span id={`home-reasoning-step-detail-${id}`} className="block truncate text-[11.5px] text-[var(--text-muted)]">
                      {state.detail}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Thought console */}
        <div id="home-reasoning-console" className="surface-tile-raised flex min-h-[260px] flex-col p-4">
          <p id="home-reasoning-console-title" className="text-caps mb-3">
            {zh ? "AI 思考過程" : "Agent reasoning"}
          </p>
          <div ref={consoleRef} id="home-reasoning-console-lines" className="max-h-64 flex-1 space-y-2.5 overflow-y-auto pr-1">
            {thoughts.map((text, i) => (
              <motion.p
                key={`${i}-${text.slice(0, 12)}`}
                id={`home-reasoning-thought-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: i === thoughts.length - 1 ? 1 : 0.55, y: 0 }}
                className="text-mono flex gap-2 text-[12.5px] leading-relaxed"
              >
                <span aria-hidden className="shrink-0 text-[var(--accent-line)]">›</span>
                {text}
              </motion.p>
            ))}
            {!error && (
              <p id="home-reasoning-cursor-line" className="text-mono flex gap-2 text-[12.5px]">
                <span aria-hidden className="shrink-0 text-[var(--accent-line)]">›</span>
                <span className="hero-cursor" aria-hidden />
              </p>
            )}
          </div>

          {error && (
            <div id="home-reasoning-error" className="mt-3 rounded-xl border border-[var(--status-blocked)]/30 bg-[var(--status-blocked-soft)] p-3">
              <p id="home-reasoning-error-text" className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--status-blocked)]">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                {zh ? "規劃中斷了。" : "Planning was interrupted."}
              </p>
              <div id="home-reasoning-error-actions" className="mt-2.5 flex gap-2">
                <button
                  id="home-reasoning-retry"
                  type="button"
                  onClick={() => setAttempt((a) => a + 1)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent-line)] px-3 text-[12px] font-bold text-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {zh ? "重試" : "Retry"}
                </button>
                <button
                  id="home-reasoning-error-back"
                  type="button"
                  onClick={onBack}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--border-hairline)] px-3 text-[12px] font-semibold text-[var(--text-muted)]"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                  {zh ? "返回選點" : "Back to picks"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <p id="home-reasoning-footnote" className="mt-6 text-center text-[12px] text-[var(--text-faint)]">
        {zh
          ? `正在為 ${country.nameZh} 之旅排出最順的動線與預算…`
          : `Charting the smoothest routes and budget for your ${country.name} trip…`}
      </p>
    </div>
  );
}

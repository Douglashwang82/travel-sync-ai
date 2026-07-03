'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ReasoningScene — phase 3 of the index-page survey pipeline.
//
// Opens the SSE stream from POST /api/home/itinerary and performs the agent's
// reasoning live in ONE chronological stream: pipeline milestones and thought
// lines interleave in the order they happen (like a modern AI thinking trace),
// under a slim five-step progress rail and a breathing aurora core fed by a
// compact stack of the visitor's picks. The server streams faster than a human
// can read, so events are buffered and played back with a minimum dwell per
// beat; the finished itinerary is handed to the parent once the choreography
// catches up.
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
import { easeConfirm, springSnappy } from "@/components/motion/variants";

type StreamEvent =
  | { kind: "step"; step: HomeReasoningStepEvent }
  | { kind: "thought"; text: string }
  | { kind: "itinerary"; itinerary: HomeItinerary }
  | { kind: "error"; message: string }
  | { kind: "done" };

type StepStatus = "pending" | "running" | "done" | "fallback";

/** One entry in the unified reasoning stream. Milestones are updated in place
 *  when their step completes; thoughts are append-only. */
type FeedItem =
  | { kind: "milestone"; stepId: HomeReasoningStepId; status: StepStatus; detail: string }
  | { kind: "thought"; text: string };

const STEP_ORDER: HomeReasoningStepId[] = ["analyze", "cluster", "plan", "solve", "cost"];

const STEP_META: Record<HomeReasoningStepId, { icon: typeof Search; en: string; zh: string }> = {
  analyze: { icon: Search, en: "Analyze picks", zh: "分析選點" },
  cluster: { icon: Layers, en: "Cluster into days", zh: "分群排天" },
  plan: { icon: Sparkles, en: "AI day planning", zh: "AI 規劃" },
  solve: { icon: Route, en: "Route & timing", zh: "動線與時間" },
  cost: { icon: Wallet, en: "Cost estimate", zh: "花費估算" },
};

const MAX_PICK_AVATARS = 8;

interface ReasoningSceneProps {
  country: HomeCountry;
  locale: "en" | "zh-TW";
  poiIds: string[];
  /** ISO YYYY-MM-DD chosen in the dates phase; server default when absent. */
  startDate?: string;
  /** Trip length from the dates phase; the planner shapes days toward it. */
  tripDays?: number;
  onComplete: (itinerary: HomeItinerary) => void;
  onBack: () => void;
}

export default function ReasoningScene({ country, locale, poiIds, startDate, tripDays, onComplete, onBack }: ReasoningSceneProps) {
  const zh = locale === "zh-TW";
  const [steps, setSteps] = useState<Record<HomeReasoningStepId, StepStatus>>(() =>
    Object.fromEntries(STEP_ORDER.map((id) => [id, "pending"])) as Record<HomeReasoningStepId, StepStatus>,
  );
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const queue: StreamEvent[] = [];
    let streamClosed = false;
    let itinerary: HomeItinerary | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // Reset visual state for retries.
    setSteps(Object.fromEntries(STEP_ORDER.map((id) => [id, "pending"])) as Record<HomeReasoningStepId, StepStatus>);
    setFeed([]);
    setError(null);

    const apply = (ev: StreamEvent) => {
      if (ev.kind === "step") {
        const status: StepStatus = ev.step.status === "start" ? "running" : ev.step.status;
        setSteps((prev) => ({ ...prev, [ev.step.id]: status }));
        setFeed((prev) => {
          if (status === "running") {
            return [...prev, { kind: "milestone", stepId: ev.step.id, status, detail: ev.step.detail }];
          }
          // Completion updates the existing milestone row in place.
          let patched = false;
          const next = prev.map((item) => {
            if (item.kind === "milestone" && item.stepId === ev.step.id) {
              patched = true;
              return { ...item, status, detail: ev.step.detail };
            }
            return item;
          });
          return patched ? next : [...next, { kind: "milestone", stepId: ev.step.id, status, detail: ev.step.detail }];
        });
      } else if (ev.kind === "thought") {
        setFeed((prev) => [...prev, { kind: "thought", text: ev.text }]);
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
          body: JSON.stringify({
            country: country.code,
            poiIds,
            locale,
            ...(startDate ? { startDate } : {}),
            ...(tripDays ? { days: tripDays } : {}),
          }),
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

  // Keep the stream pinned to the latest entry.
  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [feed]);

  const doneCount = STEP_ORDER.filter((id) => steps[id] === "done" || steps[id] === "fallback").length;
  const pickPois = poiIds.map((id) => getHomePoi(id)).filter((p) => p != null);

  return (
    <div id="home-reasoning-scene" className="mx-auto w-full max-w-2xl px-5 sm:px-8">
      {/* ─── Agent core + a compact stack of the picks feeding it ─────────── */}
      <div id="home-reasoning-core" className="relative mx-auto mb-7 flex flex-col items-center">
        <div id="home-reasoning-orb-wrap" className="relative grid h-20 w-20 place-items-center">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-[var(--accent-line)]/15 [animation-duration:2.2s]" />
          <span aria-hidden className="absolute inset-2.5 animate-ping rounded-full bg-[var(--accent-cool)]/15 [animation-duration:2.2s] [animation-delay:0.5s]" />
          <span
            id="home-reasoning-orb"
            className="gc-orb relative !h-12 !w-12"
            style={{ flexBasis: "3rem" }}
            aria-hidden
          />
        </div>

        <div id="home-reasoning-picks" className="mt-4 flex items-center gap-2.5">
          <div id="home-reasoning-pick-stack" className="flex -space-x-2">
            {pickPois.slice(0, MAX_PICK_AVATARS).map((poi, i) => (
              <motion.span
                key={poi.id}
                id={`home-reasoning-pick-${poi.id}`}
                initial={{ opacity: 0, scale: 0.5, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ ...springSnappy, delay: 0.1 + i * 0.06 }}
                title={zh ? poi.nameZh : poi.name}
                className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border-hairline)] bg-[var(--surface-raised)] text-[14px] ring-2 ring-[var(--surface-base)]"
              >
                <span aria-hidden>{poi.emoji}</span>
              </motion.span>
            ))}
            {pickPois.length > MAX_PICK_AVATARS && (
              <motion.span
                id="home-reasoning-pick-overflow"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...springSnappy, delay: 0.1 + MAX_PICK_AVATARS * 0.06 }}
                className="grid h-8 min-w-8 place-items-center rounded-full border border-[var(--border-hairline)] bg-[var(--text-primary)] px-1.5 text-[11px] font-bold text-[var(--surface-base)] ring-2 ring-[var(--surface-base)]"
              >
                +{pickPois.length - MAX_PICK_AVATARS}
              </motion.span>
            )}
          </div>
          <p id="home-reasoning-pick-count" className="text-[12.5px] font-semibold text-[var(--text-muted)]">
            {zh ? `${pickPois.length} 個選點交給 AI` : `${pickPois.length} picks handed to the agent`}
          </p>
        </div>
      </div>

      {/* ─── Slim five-step progress rail ─────────────────────────────────── */}
      <div id="home-reasoning-stepper" className="mb-4" role="group" aria-label={zh ? "規劃進度" : "Planning progress"}>
        <div id="home-reasoning-stepper-row" className="flex items-center">
          {STEP_ORDER.map((id, i) => {
            const meta = STEP_META[id];
            const status = steps[id];
            const Icon = meta.icon;
            return (
              <div key={id} id={`home-reasoning-step-${id}`} className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
                {i > 0 && (
                  <span
                    id={`home-reasoning-step-link-${id}`}
                    aria-hidden
                    className={`mx-1.5 h-px flex-1 transition-colors duration-500 ${
                      status !== "pending" ? "bg-[var(--text-primary)]" : "bg-[var(--border-strong)]"
                    }`}
                  />
                )}
                <span
                  id={`home-reasoning-step-icon-${id}`}
                  title={zh ? meta.zh : meta.en}
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors duration-300 ${
                    status === "done"
                      ? "border-transparent bg-[var(--text-primary)] text-[var(--surface-base)]"
                      : status === "fallback"
                        ? "border-transparent bg-[var(--status-needs-decision)] text-white"
                        : status === "running"
                          ? "border-[var(--accent-line)] bg-[var(--accent-line-soft)] text-[var(--accent-line)]"
                          : "border-[var(--border-hairline)] bg-[var(--surface-raised)] text-[var(--text-faint)]"
                  }`}
                >
                  {status === "done" || status === "fallback" ? (
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
                  ) : status === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Icon className="h-4 w-4" aria-hidden />
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p id="home-reasoning-stepper-label" className="text-mono mt-2 text-center text-[11.5px] font-semibold text-[var(--text-faint)]">
          {doneCount}/{STEP_ORDER.length}
          {" · "}
          {(() => {
            const running = STEP_ORDER.find((id) => steps[id] === "running");
            if (running) return zh ? STEP_META[running].zh : STEP_META[running].en;
            return doneCount === STEP_ORDER.length ? (zh ? "完成" : "Complete") : zh ? "準備中" : "Warming up";
          })()}
        </p>
      </div>

      {/* ─── The reasoning stream: milestones + thoughts, chronological ───── */}
      <motion.div
        id="home-reasoning-stream-panel"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: easeConfirm, delay: 0.1 }}
        className="surface-glass rounded-[1.4rem] border border-[var(--border-hairline)] p-2 shadow-[var(--shadow-raise)]"
      >
        <div
          ref={streamRef}
          id="home-reasoning-stream"
          className="max-h-[340px] min-h-[260px] space-y-1 overflow-y-auto p-2 [mask-image:linear-gradient(to_bottom,transparent,black_14%)]"
        >
          {feed.map((item, i) =>
            item.kind === "milestone" ? (
              <motion.div
                key={`m-${item.stepId}`}
                id={`home-reasoning-milestone-${item.stepId}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, ease: easeConfirm }}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-300 ${
                  item.status === "running" ? "bg-[var(--accent-line-soft)]" : ""
                }`}
              >
                <span
                  id={`home-reasoning-milestone-icon-${item.stepId}`}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors duration-300 ${
                    item.status === "done"
                      ? "bg-[var(--text-primary)] text-[var(--surface-base)]"
                      : item.status === "fallback"
                        ? "bg-[var(--status-needs-decision)] text-white"
                        : "border border-[var(--accent-line)] text-[var(--accent-line)]"
                  }`}
                >
                  {item.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  )}
                </span>
                <span id={`home-reasoning-milestone-text-${item.stepId}`} className="min-w-0">
                  <span className="block text-[13px] font-bold leading-tight">
                    {zh ? STEP_META[item.stepId].zh : STEP_META[item.stepId].en}
                  </span>
                  {item.detail && (
                    <span className="block truncate text-[11.5px] text-[var(--text-muted)]">{item.detail}</span>
                  )}
                </span>
              </motion.div>
            ) : (
              <motion.p
                key={`t-${i}`}
                id={`home-reasoning-thought-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: i === feed.length - 1 ? 1 : 0.55, y: 0 }}
                transition={{ duration: 0.3, ease: easeConfirm }}
                className="text-mono ml-[26px] flex gap-2 border-l border-[var(--border-hairline)] py-1 pl-4 text-[12.5px] leading-relaxed"
              >
                <span aria-hidden className="shrink-0 text-[var(--accent-line)]">›</span>
                {item.text}
              </motion.p>
            ),
          )}

          {!error && (
            <p id="home-reasoning-cursor-line" className="text-mono ml-[26px] flex gap-2 border-l border-[var(--border-hairline)] py-1 pl-4 text-[12.5px]">
              <span aria-hidden className="shrink-0 text-[var(--accent-line)]">›</span>
              <span className="hero-cursor" aria-hidden />
            </p>
          )}

          {error && (
            <div id="home-reasoning-error" className="mt-2 rounded-xl border border-[var(--status-blocked)]/30 bg-[var(--status-blocked-soft)] p-3">
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
      </motion.div>

      <p id="home-reasoning-footnote" className="mt-5 text-center text-[12px] text-[var(--text-faint)]">
        {zh
          ? `正在為 ${country.nameZh} 之旅排出最順的動線與預算…`
          : `Charting the smoothest routes and budget for your ${country.name} trip…`}
      </p>
    </div>
  );
}

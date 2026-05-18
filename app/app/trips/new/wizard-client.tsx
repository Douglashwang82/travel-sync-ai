"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Client wizard. State machine of 10 screens — the 8-question survey plus a
// "which group?" intro (when the user has more than one) and a final
// "pick a start date + review" screen. On submit, POST to
// /api/app/trips/generate and navigate to the new trip.
//
// Motion: segmented progress, direction-aware step transitions, selected-state
// pop on inputs, shimmer ribbon + rotating phrase during the AI generation
// wait. All durations come from --duration-* tokens in globals.css; the
// global prefers-reduced-motion rule collapses everything to ~0ms.
// ─────────────────────────────────────────────────────────────────────────────

interface GroupOption {
  id: string;
  name: string;
}

// Sentinel value used by the group-picker radio when the user explicitly opts
// out of binding the trip to a LINE group. Anything not in `groups` works;
// using a fixed string keeps the radio's value type stable.
const NO_GROUP_VALUE = "__none__";

type StepKey =
  | "group"
  | "destination"
  | "duration_days"
  | "party"
  | "party_size"
  | "budget_tier"
  | "vibe"
  | "pace"
  | "must_haves"
  | "review";

interface WizardState {
  groupId: string | null;
  destination: string;
  duration_days: number | null;
  party: "solo" | "couple" | "family" | "friends" | null;
  party_size: number | null;
  budget_tier: "shoestring" | "mid" | "luxury" | null;
  vibe: Array<"relaxed" | "adventure" | "culture" | "foodie" | "nightlife" | "nature">;
  pace: "chill" | "balanced" | "packed" | null;
  must_haves: string;
  startDate: string;
}

function defaultState(initialGroupId: string | null): WizardState {
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  return {
    groupId: initialGroupId,
    destination: "",
    duration_days: null,
    party: null,
    party_size: null,
    budget_tier: null,
    vibe: [],
    pace: null,
    must_haves: "",
    startDate: inTwoWeeks,
  };
}

interface SubmitResponse {
  tripId?: string;
  templateId?: string;
  error?: string;
  reason?: string;
  message?: string;
}

// Rotating "thinking" phrases shown during the /api/app/trips/generate call.
// Pure perceived-progress: the request can take 10–20s on Gemini, and the
// industry signal is that giving the system a voice builds trust on long
// waits (vs. a frozen-looking spinner).
const SUBMIT_PHRASES = [
  "正在挑選景點…",
  "正在排路線…",
  "校對交通時間…",
  "加上一點魔法…",
];

export function NewTripWizard({ groups }: { groups: GroupOption[] }): React.ReactElement {
  const router = useRouter();

  // The group step is only shown when the user actually has groups to pick
  // from. With zero groups, the trip is always created group-less; the group
  // step would have nothing to render.
  const startStep: StepKey = groups.length > 0 ? "group" : "destination";

  const [state, setState] = useState<WizardState>(() => defaultState(null));
  const [step, setStep] = useState<StepKey>(startStep);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tracks whether the user has interacted with the group step. We need this
  // because `groupId === null` is both the initial "unanswered" state and a
  // legitimate "no group" selection — the touched flag disambiguates the two.
  const [groupStepTouched, setGroupStepTouched] = useState(false);
  // Direction drives the step transition animation. forward = slide-from-right.
  const [dir, setDir] = useState<"forward" | "back">("forward");
  // Single transient nudge target — when the user tries to exceed the vibe
  // cap, this names the pill that should shake. Cleared after the animation.
  const [nudgeKey, setNudgeKey] = useState<string | null>(null);
  // Rotating phrase index during submit. Resets when submit ends.
  const [phraseIdx, setPhraseIdx] = useState(0);
  // One-shot button shake on submit error.
  const [errorShake, setErrorShake] = useState(false);

  const steps = useMemo<StepKey[]>(() => {
    const base: StepKey[] = [
      "destination",
      "duration_days",
      "party",
      "party_size",
      "budget_tier",
      "vibe",
      "pace",
      "must_haves",
      "review",
    ];
    return groups.length > 0 ? (["group", ...base] as StepKey[]) : base;
  }, [groups.length]);

  const stepIndex = steps.indexOf(step);

  const advance = useCallback((): void => {
    const next = steps[stepIndex + 1];
    if (next) {
      setDir("forward");
      setStep(next);
    }
  }, [steps, stepIndex]);

  const back = useCallback((): void => {
    const prev = steps[stepIndex - 1];
    if (prev) {
      setDir("back");
      setStep(prev);
    }
  }, [steps, stepIndex]);

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setSubmitError(null);

    const body = {
      groupId: state.groupId ?? null,
      startDate: state.startDate,
      answers: {
        destination: state.destination.trim(),
        duration_days: state.duration_days,
        party: state.party,
        party_size: state.party_size,
        budget_tier: state.budget_tier,
        vibe: state.vibe,
        pace: state.pace,
        must_haves: state.must_haves.trim() || null,
      },
    };

    try {
      const res = await fetch("/api/app/trips/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as SubmitResponse;
      if (!res.ok || !json.tripId) {
        setSubmitError(humanizeError(json));
        setSubmitting(false);
        setErrorShake(true);
        return;
      }
      router.push(`/app/trips/${json.tripId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交失敗，請稍後再試。");
      setSubmitting(false);
      setErrorShake(true);
    }
  }

  // Rotate the submit phrase every ~2.5s while the AI call is in flight.
  useEffect(() => {
    if (!submitting) {
      setPhraseIdx(0);
      return;
    }
    const id = window.setInterval(() => {
      setPhraseIdx((i) => (i + 1) % SUBMIT_PHRASES.length);
    }, 2500);
    return () => window.clearInterval(id);
  }, [submitting]);

  // Reset the one-shot shake after its animation completes so it can replay.
  useEffect(() => {
    if (!errorShake) return;
    const id = window.setTimeout(() => setErrorShake(false), 240);
    return () => window.clearTimeout(id);
  }, [errorShake]);

  // Keyboard QoL: Enter advances when valid, Esc goes back. Submit handled
  // by the explicit button on the review step (Enter still works there too).
  const canAdvanceNow = canAdvance(state, step, groupStepTouched);
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (submitting) return;
      // Ignore Enter inside multiline textareas so users can still wrap lines.
      const target = e.target as HTMLElement | null;
      const isTextArea = target?.tagName === "TEXTAREA";
      if (e.key === "Enter" && !isTextArea) {
        if (step === "review") {
          if (canSubmit(state)) {
            e.preventDefault();
            void handleSubmit();
          }
          return;
        }
        if (canAdvanceNow) {
          e.preventDefault();
          advance();
        }
        return;
      }
      if (e.key === "Escape" && stepIndex > 0) {
        e.preventDefault();
        back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleSubmit is stable enough — re-binding on every render is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, stepIndex, canAdvanceNow, submitting, state, advance, back]);

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/app" className="text-sm text-muted-foreground hover:underline">
          ← 取消
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums">
          第 {stepIndex + 1} / {steps.length} 步
        </span>
      </header>

      <SegmentedProgress total={steps.length} current={stepIndex} />

      <div data-dir={dir} className="flex flex-1 flex-col gap-6 pt-4">
        <div key={step} className="wizard-step flex flex-col gap-6">
          {step === "group" && (
            <StepShell
              title="這趟旅程要建在哪個群組？"
              hint="可選擇綁定 LINE 群組，或建立個人旅程。"
              answered={state.groupId != null || groupStepTouched}
            >
              <RadioList
                options={[
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                  { value: NO_GROUP_VALUE, label: "不綁定群組（個人旅程）" },
                ]}
                value={state.groupId ?? (groupStepTouched ? NO_GROUP_VALUE : null)}
                onChange={(v) => {
                  setGroupStepTouched(true);
                  setState({ ...state, groupId: v === NO_GROUP_VALUE ? null : v });
                }}
              />
            </StepShell>
          )}

          {step === "destination" && (
            <StepShell
              title="目的地是哪裡？"
              hint="例：京都、台北、Bangkok。"
              answered={state.destination.trim().length >= 2}
            >
              <Input
                autoFocus
                value={state.destination}
                onChange={(e) => setState({ ...state, destination: e.target.value })}
                placeholder="輸入城市或地區"
              />
            </StepShell>
          )}

          {step === "duration_days" && (
            <StepShell
              title="旅程幾天？"
              hint="之後可在看板上微調。"
              answered={state.duration_days != null}
            >
              <RadioList
                options={[2, 3, 5, 7, 10, 14].map((n) => ({ value: String(n), label: `${n} 天` }))}
                value={state.duration_days != null ? String(state.duration_days) : null}
                onChange={(v) => setState({ ...state, duration_days: parseInt(v, 10) })}
              />
            </StepShell>
          )}

          {step === "party" && (
            <StepShell
              title="和誰一起？"
              hint="影響行程的節奏與選擇。"
              answered={state.party != null}
            >
              <RadioList
                options={[
                  { value: "solo", label: "一個人" },
                  { value: "couple", label: "情侶" },
                  { value: "family", label: "家庭" },
                  { value: "friends", label: "朋友" },
                ]}
                value={state.party}
                onChange={(v) => setState({ ...state, party: v as WizardState["party"] })}
              />
            </StepShell>
          )}

          {step === "party_size" && (
            <StepShell
              title="共幾人？"
              hint="用於估算交通與訂位。"
              answered={state.party_size != null}
            >
              <RadioList
                options={[1, 2, 3, 4, 6, 8].map((n) => ({
                  value: String(n),
                  label: n === 8 ? "8+" : String(n),
                }))}
                value={state.party_size != null ? String(state.party_size) : null}
                onChange={(v) => setState({ ...state, party_size: parseInt(v, 10) })}
              />
            </StepShell>
          )}

          {step === "budget_tier" && (
            <StepShell
              title="預算？"
              hint="影響餐廳與住宿方向。"
              answered={state.budget_tier != null}
            >
              <RadioList
                options={[
                  { value: "shoestring", label: "省錢（街頭美食 / 青旅）" },
                  { value: "mid", label: "中等（一般餐館 / 三星）" },
                  { value: "luxury", label: "高級（精緻餐飲 / 四五星）" },
                ]}
                value={state.budget_tier}
                onChange={(v) =>
                  setState({ ...state, budget_tier: v as WizardState["budget_tier"] })
                }
              />
            </StepShell>
          )}

          {step === "vibe" && (
            <StepShell
              title="想要的氛圍？"
              hint={`最多選 3 個（已選 ${state.vibe.length}/3）`}
              answered={state.vibe.length >= 1}
            >
              <PillMultiSelect
                options={[
                  { value: "relaxed", label: "放鬆" },
                  { value: "adventure", label: "冒險" },
                  { value: "culture", label: "文化" },
                  { value: "foodie", label: "美食" },
                  { value: "nightlife", label: "夜生活" },
                  { value: "nature", label: "自然" },
                ]}
                selected={state.vibe}
                max={3}
                nudgeKey={nudgeKey}
                onChange={(next) => setState({ ...state, vibe: next as WizardState["vibe"] })}
                onOverCap={(v) => {
                  setNudgeKey(v);
                  window.setTimeout(() => setNudgeKey(null), 250);
                }}
              />
            </StepShell>
          )}

          {step === "pace" && (
            <StepShell
              title="行程節奏？"
              hint="每天大概幾站。"
              answered={state.pace != null}
            >
              <RadioList
                options={[
                  { value: "chill", label: "悠閒（≤3 站／天）" },
                  { value: "balanced", label: "均衡（3–5 站／天）" },
                  { value: "packed", label: "緊湊（5–6 站／天）" },
                ]}
                value={state.pace}
                onChange={(v) => setState({ ...state, pace: v as WizardState["pace"] })}
              />
            </StepShell>
          )}

          {step === "must_haves" && (
            <StepShell
              title="有什麼一定要的事？"
              hint="可選填，例：想吃壽司、想看夜景。"
              answered={true}
            >
              <Textarea
                value={state.must_haves}
                onChange={(e) => setState({ ...state, must_haves: e.target.value })}
                placeholder="（可空白）"
                rows={4}
              />
            </StepShell>
          )}

          {step === "review" && (
            <StepShell
              title="最後一步：開始日期"
              hint="生成後可在看板修改。"
              answered={canSubmit(state)}
            >
              <Label htmlFor="start_date" className="text-sm">
                開始日期
              </Label>
              <Input
                id="start_date"
                type="date"
                value={state.startDate}
                onChange={(e) => setState({ ...state, startDate: e.target.value })}
              />
              <ReviewSummary state={state} groupName={groupName(groups, state.groupId)} />
              {submitting && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="wizard-ribbon" aria-hidden />
                  <p
                    key={phraseIdx}
                    className="wizard-phrase text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    {SUBMIT_PHRASES[phraseIdx]}
                  </p>
                </div>
              )}
              {submitError && (
                <p className="wizard-error text-sm text-destructive" role="alert">
                  {submitError}
                </p>
              )}
            </StepShell>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-between pt-4">
        {stepIndex > 0 ? (
          <Button variant="ghost" onClick={back} disabled={submitting}>
            ← 上一步
          </Button>
        ) : (
          <span />
        )}

        {step !== "review" ? (
          <Button
            onClick={advance}
            disabled={!canAdvanceNow}
            className="transition-transform active:scale-[0.98]"
          >
            下一步 →
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitting || !canSubmit(state)}
            data-nudge={errorShake ? "true" : undefined}
            className={cn(
              "wizard-pill transition-transform active:scale-[0.98]",
              submitting && "min-w-[10rem]"
            )}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                生成中…
              </span>
            ) : (
              "生成旅程草稿"
            )}
          </Button>
        )}
      </footer>
    </main>
  );
}

// ─── Progress ──────────────────────────────────────────────────────────────

function SegmentedProgress({
  total,
  current,
}: {
  total: number;
  current: number;
}): React.ReactElement {
  return (
    <div
      className="flex w-full gap-1"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={current + 1}
    >
      {Array.from({ length: total }).map((_, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <span
            key={i}
            data-state={state}
            className="wizard-seg h-1 flex-1 rounded-full"
            aria-hidden
          />
        );
      })}
    </div>
  );
}

// ─── Step shell + inputs ────────────────────────────────────────────────────

function StepShell({
  title,
  hint,
  answered,
  children,
}: {
  title: string;
  hint: string;
  answered: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          {title}
          {answered && (
            <span
              className="bento-tick-pop inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary"
              aria-label="已填寫"
            >
              <Check className="h-4 w-4" strokeWidth={3} />
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function RadioList<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (v: T) => void;
}): React.ReactElement {
  // Number-key shortcuts (1..N pick the Nth option). Scoped to keypresses
  // while this list is the most recent one rendered; cheap to set up.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key < "1" || e.key > "9") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const idx = parseInt(e.key, 10) - 1;
      const opt = options[idx];
      if (opt) {
        e.preventDefault();
        onChange(opt.value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onChange]);

  return (
    <div className="flex flex-col gap-2">
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            data-active={active ? "true" : "false"}
            className={cn(
              "wizard-radio group flex items-center justify-between rounded-md border pl-5 pr-4 py-3 text-left text-sm",
              active
                ? "border-primary bg-primary/5 font-medium"
                : "border-input hover:bg-accent"
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className="hidden sm:inline-block w-5 text-xs text-muted-foreground tabular-nums"
                aria-hidden
              >
                {i + 1}
              </span>
              {opt.label}
            </span>
            {active && (
              <Check
                className="bento-tick-pop h-4 w-4 text-primary"
                strokeWidth={3}
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function PillMultiSelect<T extends string>({
  options,
  selected,
  max,
  nudgeKey,
  onChange,
  onOverCap,
}: {
  options: Array<{ value: T; label: string }>;
  selected: T[];
  max: number;
  nudgeKey: string | null;
  onChange: (next: T[]) => void;
  onOverCap: (value: T) => void;
}): React.ReactElement {
  function toggle(v: T): void {
    if (selected.includes(v)) {
      onChange(selected.filter((s) => s !== v));
      return;
    }
    if (selected.length >= max) {
      onOverCap(v);
      return;
    }
    onChange([...selected, v]);
  }

  // Number-key shortcuts for pills too.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key < "1" || e.key > "9") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const idx = parseInt(e.key, 10) - 1;
      const opt = options[idx];
      if (opt) {
        e.preventDefault();
        toggle(opt.value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, selected]);

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        const isNudged = nudgeKey === opt.value;
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => toggle(opt.value)}
            data-active={active ? "true" : "false"}
            data-nudge={isNudged ? "true" : undefined}
            className={cn(
              "wizard-pill inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input hover:bg-accent"
            )}
          >
            {active && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ReviewSummary({
  state,
  groupName,
}: {
  state: WizardState;
  groupName: string | null;
}): React.ReactElement {
  const rows: Array<[string, string]> = [
    ["群組", groupName ?? "（不綁定群組）"],
    ["目的地", state.destination || "—"],
    ["天數", state.duration_days ? `${state.duration_days} 天` : "—"],
    ["人數", state.party_size != null ? `${state.party_size} 人（${humanParty(state.party)}）` : "—"],
    ["預算", humanBudget(state.budget_tier)],
    ["氛圍", state.vibe.map(humanVibe).join("、") || "—"],
    ["節奏", humanPace(state.pace)],
    ["必做", state.must_haves || "（無）"],
  ];
  return (
    <div className="mt-4 rounded-md border border-input bg-muted/30 p-4 text-sm">
      <p className="mb-2 font-medium">確認一下：</p>
      <dl className="bento-stagger grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─── Validation + display helpers ───────────────────────────────────────────

function canAdvance(
  state: WizardState,
  step: StepKey,
  groupStepTouched: boolean
): boolean {
  switch (step) {
    case "group":
      // Either a specific group or the explicit "no group" selection counts as
      // answered. `state.groupId === null` alone is ambiguous (see touched).
      return state.groupId != null || groupStepTouched;
    case "destination":
      return state.destination.trim().length >= 2;
    case "duration_days":
      return state.duration_days != null;
    case "party":
      return state.party != null;
    case "party_size":
      return state.party_size != null;
    case "budget_tier":
      return state.budget_tier != null;
    case "vibe":
      return state.vibe.length >= 1;
    case "pace":
      return state.pace != null;
    case "must_haves":
      return true;
    default:
      return true;
  }
}

function canSubmit(state: WizardState): boolean {
  return (
    state.destination.trim().length >= 2 &&
    state.duration_days != null &&
    state.party != null &&
    state.party_size != null &&
    state.budget_tier != null &&
    state.vibe.length >= 1 &&
    state.pace != null &&
    /^\d{4}-\d{2}-\d{2}$/.test(state.startDate)
  );
}

function groupName(groups: GroupOption[], id: string | null): string | null {
  if (!id) return null;
  return groups.find((g) => g.id === id)?.name ?? null;
}

function humanParty(p: WizardState["party"]): string {
  return { solo: "一個人", couple: "情侶", family: "家庭", friends: "朋友" }[p ?? "solo"] ?? "—";
}
function humanBudget(b: WizardState["budget_tier"]): string {
  if (!b) return "—";
  return { shoestring: "省錢", mid: "中等", luxury: "高級" }[b];
}
function humanVibe(v: string): string {
  return (
    {
      relaxed: "放鬆",
      adventure: "冒險",
      culture: "文化",
      foodie: "美食",
      nightlife: "夜生活",
      nature: "自然",
    } as Record<string, string>
  )[v] ?? v;
}
function humanPace(p: WizardState["pace"]): string {
  if (!p) return "—";
  return { chill: "悠閒", balanced: "均衡", packed: "緊湊" }[p];
}

function humanizeError(json: SubmitResponse): string {
  if (json.reason === "gemini_unavailable") return "AI 服務暫時無法回應，請稍後再試。";
  if (json.reason === "no_candidates") return "找不到這個目的地的景點資料，請換一個地點。";
  if (json.reason === "irreparable") return "條件太緊，AI 無法排出可行行程。建議放寬節奏或天數。";
  if (json.error === "forbidden") return "你不是這個群組的成員。";
  return json.message ?? "生成失敗，請稍後再試。";
}

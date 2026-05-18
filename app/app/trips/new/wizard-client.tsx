"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const progress = ((stepIndex + 1) / steps.length) * 100;

  function advance(): void {
    const next = steps[stepIndex + 1];
    if (next) setStep(next);
  }

  function back(): void {
    const prev = steps[stepIndex - 1];
    if (prev) setStep(prev);
  }

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
        return;
      }
      router.push(`/app/trips/${json.tripId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交失敗，請稍後再試。");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/app" className="text-sm text-muted-foreground hover:underline">
          ← 取消
        </Link>
        <span className="text-xs text-muted-foreground">
          {stepIndex + 1} / {steps.length}
        </span>
      </header>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-1 flex-col gap-6 pt-4">
        {step === "group" && (
          <StepShell title="這趟旅程要建在哪個群組？" hint="可選擇綁定 LINE 群組，或建立個人旅程。">
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
          <StepShell title="目的地是哪裡？" hint="例：京都、台北、Bangkok。">
            <Input
              autoFocus
              value={state.destination}
              onChange={(e) => setState({ ...state, destination: e.target.value })}
              placeholder="輸入城市或地區"
            />
          </StepShell>
        )}

        {step === "duration_days" && (
          <StepShell title="旅程幾天？" hint="之後可在看板上微調。">
            <RadioList
              options={[2, 3, 5, 7, 10, 14].map((n) => ({ value: String(n), label: `${n} 天` }))}
              value={state.duration_days != null ? String(state.duration_days) : null}
              onChange={(v) => setState({ ...state, duration_days: parseInt(v, 10) })}
            />
          </StepShell>
        )}

        {step === "party" && (
          <StepShell title="和誰一起？" hint="影響行程的節奏與選擇。">
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
          <StepShell title="共幾人？" hint="用於估算交通與訂位。">
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
          <StepShell title="預算？" hint="影響餐廳與住宿方向。">
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
          <StepShell title="想要的氛圍？" hint="最多選 3 個。">
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
              onChange={(next) => setState({ ...state, vibe: next as WizardState["vibe"] })}
            />
          </StepShell>
        )}

        {step === "pace" && (
          <StepShell title="行程節奏？" hint="每天大概幾站。">
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
          <StepShell title="有什麼一定要的事？" hint="可選填，例：想吃壽司、想看夜景。">
            <Textarea
              value={state.must_haves}
              onChange={(e) => setState({ ...state, must_haves: e.target.value })}
              placeholder="（可空白）"
              rows={4}
            />
          </StepShell>
        )}

        {step === "review" && (
          <StepShell title="最後一步：開始日期" hint="生成後可在看板修改。">
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
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          </StepShell>
        )}
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
          <Button onClick={advance} disabled={!canAdvance(state, step, groupStepTouched)}>
            下一步 →
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit(state)}>
            {submitting ? "正在生成…" : "生成旅程草稿"}
          </Button>
        )}
      </footer>
    </main>
  );
}

// ─── Step shell + inputs ────────────────────────────────────────────────────

function StepShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
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
  return (
    <div className="flex flex-col gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-md border px-4 py-3 text-left text-sm transition-colors",
              active
                ? "border-primary bg-primary/5 font-medium"
                : "border-input hover:bg-accent"
            )}
          >
            {opt.label}
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
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  selected: T[];
  max: number;
  onChange: (next: T[]) => void;
}): React.ReactElement {
  function toggle(v: T): void {
    if (selected.includes(v)) {
      onChange(selected.filter((s) => s !== v));
      return;
    }
    if (selected.length >= max) return;
    onChange([...selected, v]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => toggle(opt.value)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input hover:bg-accent"
            )}
          >
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
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
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

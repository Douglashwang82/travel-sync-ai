"use client";

// /app/benchmark — interactive console for the itinerary quality benchmark.
//
// Three surfaces over the /api/app/benchmark endpoints:
//   1. Preset scenario cards (benchmarks/scenarios.json) + an ad-hoc run
//      dialog — each Run executes the real generation pipeline server-side
//      and lands a row in `benchmark_runs`.
//   2. A score-over-time line chart (one series per scenario, deterministic
//      total only — the judge score lives in the table).
//   3. Expandable run history with per-metric scores, judge verdict and
//      housekeeping (delete row).
//
// Chart palette: the validated categorical set from the dataviz reference
// (5 slots, light+dark steps, CVD-checked). Colors are assigned to scenarios
// in a fixed, stable order — never re-assigned when filters change. Scenarios
// beyond the 5 slots render in neutral gray. The history table below doubles
// as the accessible table view of the chart.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Play, Loader2, Trash2, ChevronDown, Plus } from "lucide-react";
import { appFetchJson, AppApiFetchError } from "@/lib/app-client";
import { useAppLocale } from "@/components/app/app-locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TabPageHeader,
  TabSurface,
  TabSurfaceTitle,
  TabError,
  TabSkeleton,
  TabEmptyState,
} from "@/components/app/tab-shell";
import { cn } from "@/lib/utils";
import type {
  BenchmarkRunRecord,
  BenchmarkScenario,
  BenchmarkAnswers,
} from "@/services/trip-generation/benchmark-runner";
import type {
  BenchmarkScenariosResponse,
  // type-only import; the route module never ships to the client bundle
} from "@/app/api/app/benchmark/scenarios/route";
import type {
  BenchmarkRunsResponse,
  BenchmarkRunResponse,
} from "@/app/api/app/benchmark/runs/route";

// ─── Copy ───────────────────────────────────────────────────────────────────

const COPY = {
  en: {
    eyebrow: "Quality lab",
    title: "Itinerary Benchmark",
    subtitle:
      "Run the real generation pipeline against fixed scenarios, score the result on seven deterministic metrics plus an LLM judge, and track quality over time.",
    scenarios: "Scenarios",
    scenariosHint: "Presets from benchmarks/scenarios.json — same set the CLI runs.",
    customRun: "Custom run",
    run: "Run",
    running: "Running…",
    runningBanner: (id: string, secs: number) =>
      `Running “${id}” — generating a real itinerary, scoring, judging… ${secs}s`,
    runWarning: "A run makes real LLM calls and takes 30–120 s.",
    latest: "latest",
    noRunsYet: "no runs yet",
    trend: "Score trend",
    trendHint: "Deterministic total (0–100) per run. Judge scores are in the table below.",
    trendEmpty: "Run a scenario to start the trend line.",
    grayNote: "gray = beyond the 5 colored slots",
    history: "Run history",
    historyHint: "Every run — web and CLI — recorded in benchmark_runs.",
    historyEmpty: "No benchmark runs recorded yet.",
    historyEmptyHint: "Hit Run on a scenario above, or `npm run benchmark:itinerary` from the CLI.",
    allScenarios: "All scenarios",
    colDate: "Date",
    colScenario: "Scenario",
    colSource: "Source",
    colScore: "Score",
    colJudge: "Judge",
    colStatus: "Status",
    statusOk: "ok",
    judgePass: "pass",
    judgeFail: "fail",
    judgeSkipped: "—",
    metrics: "Deterministic metrics",
    judgeVerdict: "Judge verdict",
    judgeReasoning: "Reasoning",
    statsLine: (s: { totalStops: number; restaurants: number; nonEmptyDays: number; durationDays: number }) =>
      `${s.totalStops} stops · ${s.restaurants} restaurants · ${s.nonEmptyDays}/${s.durationDays} days planned`,
    runDetails: "Run details",
    confirmDelete: "Delete this benchmark run from the history?",
    loadError: "Failed to load the benchmark data.",
    runError: "Benchmark run failed",
    close: "Close",
    // custom run form
    customTitle: "Custom benchmark run",
    customDescription:
      "Define a one-off scenario. It runs immediately and is recorded as “adhoc” in the history.",
    fDestination: "Destination",
    fDestinationPh: "e.g. Niseko, Japan",
    fDuration: "Days",
    fStartDate: "Start date",
    fParty: "Party",
    fPartySize: "People",
    fBudget: "Budget",
    fPace: "Pace",
    fVibes: "Vibes",
    fMustHaves: "Must-haves",
    fMustHavesPh: "e.g. onsen、ski school",
    fJudge: "Run LLM judge",
    fJudgeHint: "Grades day coherence, personalization, realism (extra LLM call).",
    cancel: "Cancel",
    startRun: "Start run",
    party: { solo: "Solo", couple: "Couple", family: "Family", friends: "Friends" },
    budget: { shoestring: "Shoestring", mid: "Mid", luxury: "Luxury" },
    pace: { chill: "Chill", balanced: "Balanced", packed: "Packed" },
    vibes: {
      relaxed: "Relaxed",
      adventure: "Adventure",
      culture: "Culture",
      foodie: "Foodie",
      nightlife: "Nightlife",
      nature: "Nature",
    },
    metricNames: {
      coverage: "Coverage",
      pace_fit: "Pace fit",
      meal_coverage: "Meals",
      travel_efficiency: "Travel",
      diversity: "Diversity",
      vibe_alignment: "Vibe match",
      must_haves: "Must-haves",
    },
    aspectNames: {
      day_coherence: "Day coherence",
      personalization: "Personalization",
      realism: "Realism",
      title_summary_quality: "Title/summary",
    },
  },
  "zh-TW": {
    eyebrow: "品質實驗室",
    title: "行程基準測試",
    subtitle:
      "以固定情境跑真實生成管線，用七項確定性指標加上 LLM 評審打分，長期追蹤品質變化。",
    scenarios: "情境",
    scenariosHint: "來自 benchmarks/scenarios.json 的預設情境 — 與 CLI 使用同一組。",
    customRun: "自訂執行",
    run: "執行",
    running: "執行中…",
    runningBanner: (id: string, secs: number) =>
      `正在執行「${id}」— 生成真實行程、打分、評審中… ${secs} 秒`,
    runWarning: "每次執行都會呼叫真實 LLM，約需 30–120 秒。",
    latest: "最新",
    noRunsYet: "尚無執行",
    trend: "分數趨勢",
    trendHint: "每次執行的確定性總分（0–100）。評審分數請見下方表格。",
    trendEmpty: "執行任一情境即可開始累積趨勢線。",
    grayNote: "灰色＝超出 5 個彩色欄位的情境",
    history: "執行歷史",
    historyHint: "所有執行（Web 與 CLI）都記錄在 benchmark_runs。",
    historyEmpty: "尚未有任何基準測試紀錄。",
    historyEmptyHint: "點上方情境的「執行」，或在 CLI 執行 `npm run benchmark:itinerary`。",
    allScenarios: "全部情境",
    colDate: "日期",
    colScenario: "情境",
    colSource: "來源",
    colScore: "分數",
    colJudge: "評審",
    colStatus: "狀態",
    statusOk: "成功",
    judgePass: "通過",
    judgeFail: "未過",
    judgeSkipped: "—",
    metrics: "確定性指標",
    judgeVerdict: "評審結果",
    judgeReasoning: "評語",
    statsLine: (s: { totalStops: number; restaurants: number; nonEmptyDays: number; durationDays: number }) =>
      `${s.totalStops} 個地點 · ${s.restaurants} 家餐廳 · 已安排 ${s.nonEmptyDays}/${s.durationDays} 天`,
    runDetails: "執行詳情",
    confirmDelete: "確定要從歷史中刪除這筆紀錄嗎？",
    loadError: "讀取基準測試資料失敗。",
    runError: "基準測試執行失敗",
    close: "關閉",
    customTitle: "自訂基準測試",
    customDescription: "定義一次性的情境，立即執行並以「adhoc」記錄於歷史。",
    fDestination: "目的地",
    fDestinationPh: "例如：Niseko, Japan",
    fDuration: "天數",
    fStartDate: "出發日",
    fParty: "同行類型",
    fPartySize: "人數",
    fBudget: "預算",
    fPace: "節奏",
    fVibes: "氛圍",
    fMustHaves: "必備項目",
    fMustHavesPh: "例如：onsen、ski school",
    fJudge: "啟用 LLM 評審",
    fJudgeHint: "評分每日連貫性、個人化、可執行性（額外一次 LLM 呼叫）。",
    cancel: "取消",
    startRun: "開始執行",
    party: { solo: "單人", couple: "情侶", family: "家庭", friends: "朋友" },
    budget: { shoestring: "省錢", mid: "中等", luxury: "奢華" },
    pace: { chill: "悠閒", balanced: "均衡", packed: "緊湊" },
    vibes: {
      relaxed: "放鬆",
      adventure: "冒險",
      culture: "文化",
      foodie: "美食",
      nightlife: "夜生活",
      nature: "自然",
    },
    metricNames: {
      coverage: "天數覆蓋",
      pace_fit: "節奏契合",
      meal_coverage: "用餐安排",
      travel_efficiency: "移動效率",
      diversity: "多樣性",
      vibe_alignment: "氛圍契合",
      must_haves: "必備項目",
    },
    aspectNames: {
      day_coherence: "每日連貫性",
      personalization: "個人化",
      realism: "可執行性",
      title_summary_quality: "標題/摘要",
    },
  },
};

type Copy = (typeof COPY)["en"];

// ─── Chart palette (validated; see dataviz reference palette) ───────────────
// Slot order is the CVD-safety mechanism — fixed, never cycled. The Tailwind
// arbitrary properties on the chart root swap the dark steps in.

const SERIES_VARS = ["--viz-s1", "--viz-s2", "--viz-s3", "--viz-s4", "--viz-s5"] as const;
const SERIES_FALLBACK_VAR = "--viz-sx"; // neutral gray for scenarios beyond 5

const CHART_PALETTE_CLASSES = cn(
  "[--viz-s1:#2a78d6] [--viz-s2:#1baf7a] [--viz-s3:#eda100] [--viz-s4:#4a3aa7] [--viz-s5:#e34948] [--viz-sx:#6b7280]",
  "dark:[--viz-s1:#3987e5] dark:[--viz-s2:#199e70] dark:[--viz-s3:#c98500] dark:[--viz-s4:#9085e9] dark:[--viz-s5:#e66767] dark:[--viz-sx:#9ca3af]"
);

// ─── Small helpers ──────────────────────────────────────────────────────────

const METRIC_IDS = [
  "coverage",
  "pace_fit",
  "meal_coverage",
  "travel_efficiency",
  "diversity",
  "vibe_alignment",
  "must_haves",
] as const;

function fmtDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === "zh-TW" ? "zh-TW" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function scenarioLabel(id: string): string {
  return id === "adhoc" ? "adhoc" : id;
}

// ─── Root component ─────────────────────────────────────────────────────────

export function BenchmarkClient() {
  const { locale } = useAppLocale();
  const copy = COPY[locale];

  const [scenarios, setScenarios] = useState<BenchmarkScenario[] | null>(null);
  const [runs, setRuns] = useState<BenchmarkRunRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runSeconds, setRunSeconds] = useState(0);
  const [scenarioFilter, setScenarioFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        appFetchJson<BenchmarkScenariosResponse>("/api/app/benchmark/scenarios"),
        appFetchJson<BenchmarkRunsResponse>("/api/app/benchmark/runs?limit=100"),
      ]);
      setScenarios(s.scenarios);
      setRuns(r.runs);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof AppApiFetchError ? err.message : copy.loadError);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Elapsed-seconds ticker while a run is in flight.
  useEffect(() => {
    if (!runningId) return;
    setRunSeconds(0);
    const t = setInterval(() => setRunSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [runningId]);

  const executeRun = useCallback(
    async (label: string, body: Record<string, unknown>) => {
      setRunError(null);
      setRunningId(label);
      try {
        const res = await appFetchJson<BenchmarkRunResponse>("/api/app/benchmark/runs", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setRuns((prev) => [res.run, ...(prev ?? [])]);
        if (!res.run.ok) {
          setRunError(`${copy.runError}: ${res.run.failure_reason ?? "unknown"}`);
        }
      } catch (err) {
        setRunError(
          err instanceof AppApiFetchError ? `${copy.runError}: ${err.message}` : copy.runError
        );
      } finally {
        setRunningId(null);
      }
    },
    [copy.runError]
  );

  const deleteRun = useCallback(
    async (id: string) => {
      if (!window.confirm(copy.confirmDelete)) return;
      try {
        await appFetchJson(`/api/app/benchmark/runs/${id}`, { method: "DELETE" });
        setRuns((prev) => (prev ?? []).filter((r) => r.id !== id));
      } catch (err) {
        setRunError(err instanceof AppApiFetchError ? err.message : copy.loadError);
      }
    },
    [copy.confirmDelete, copy.loadError]
  );

  // Stable scenario → color-slot assignment: presets in file order first,
  // then any other scenario ids from history (alphabetical). Filters never
  // re-assign colors — the map is derived from the full data set.
  const seriesVarByScenario = useMemo(() => {
    const ordered: string[] = [];
    for (const s of scenarios ?? []) ordered.push(s.id);
    const extras = Array.from(
      new Set((runs ?? []).map((r) => r.scenario_id).filter((id) => !ordered.includes(id)))
    ).sort();
    ordered.push(...extras);
    const map = new Map<string, string>();
    ordered.forEach((id, i) => {
      map.set(id, i < SERIES_VARS.length ? SERIES_VARS[i] : SERIES_FALLBACK_VAR);
    });
    return map;
  }, [scenarios, runs]);

  const latestByScenario = useMemo(() => {
    const map = new Map<string, BenchmarkRunRecord>();
    for (const r of runs ?? []) {
      // runs are newest-first; keep the first ok row per scenario
      if (r.ok && !map.has(r.scenario_id)) map.set(r.scenario_id, r);
    }
    return map;
  }, [runs]);

  const filteredRuns = useMemo(() => {
    if (!runs) return [];
    return scenarioFilter === "all" ? runs : runs.filter((r) => r.scenario_id === scenarioFilter);
  }, [runs, scenarioFilter]);

  const knownScenarioIds = useMemo(
    () => Array.from(seriesVarByScenario.keys()),
    [seriesVarByScenario]
  );

  const loading = scenarios === null || runs === null;

  return (
    <div id="benchmark-page" className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <TabPageHeader
        id="benchmark-header"
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <Button
            id="benchmark-custom-run-btn"
            variant="outline"
            size="sm"
            disabled={runningId !== null}
            onClick={() => setCustomOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            {copy.customRun}
          </Button>
        }
      />

      {loadError && (
        <TabError message={loadError} onRetry={() => void load()} />
      )}
      {runError && (
        <div
          id="benchmark-run-error"
          className="rounded-[var(--radius-tile)] border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-4 py-3 text-sm text-[var(--status-blocked)]"
        >
          {runError}
        </div>
      )}
      {runningId && (
        <div
          id="benchmark-running-banner"
          role="status"
          className="flex items-center gap-3 rounded-[var(--radius-tile)] border border-[var(--border-hairline)] bg-[var(--surface-sunken)]/60 px-4 py-3 text-sm text-[var(--text-primary)]"
        >
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-line)]" aria-hidden />
          <span id="benchmark-running-text">{copy.runningBanner(runningId, runSeconds)}</span>
        </div>
      )}

      {loading && !loadError ? (
        <div id="benchmark-skeletons" className="flex flex-col gap-6">
          <TabSkeleton height={160} />
          <TabSkeleton height={260} />
          <TabSkeleton height={300} />
        </div>
      ) : !loadError ? (
        <>
          <ScenarioSection
            copy={copy}
            scenarios={scenarios ?? []}
            latestByScenario={latestByScenario}
            seriesVarByScenario={seriesVarByScenario}
            runningId={runningId}
            onRun={(id) => void executeRun(id, { scenarioId: id })}
          />

          <TrendSection
            copy={copy}
            locale={locale}
            runs={runs ?? []}
            scenarioFilter={scenarioFilter}
            seriesVarByScenario={seriesVarByScenario}
          />

          <HistorySection
            copy={copy}
            locale={locale}
            runs={filteredRuns}
            allEmpty={(runs ?? []).length === 0}
            scenarioIds={knownScenarioIds}
            scenarioFilter={scenarioFilter}
            onScenarioFilter={setScenarioFilter}
            seriesVarByScenario={seriesVarByScenario}
            expandedId={expandedId}
            onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
            onDelete={(id) => void deleteRun(id)}
          />
        </>
      ) : null}

      <CustomRunDialog
        copy={copy}
        open={customOpen}
        onOpenChange={setCustomOpen}
        disabled={runningId !== null}
        onSubmit={(scenario, judge) => {
          setCustomOpen(false);
          void executeRun("adhoc", { scenario, judge });
        }}
      />
    </div>
  );
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

function ScenarioSection({
  copy,
  scenarios,
  latestByScenario,
  seriesVarByScenario,
  runningId,
  onRun,
}: {
  copy: Copy;
  scenarios: BenchmarkScenario[];
  latestByScenario: Map<string, BenchmarkRunRecord>;
  seriesVarByScenario: Map<string, string>;
  runningId: string | null;
  onRun: (id: string) => void;
}) {
  return (
    <TabSurface id="benchmark-scenarios" className="flex flex-col gap-4">
      <TabSurfaceTitle
        id="benchmark-scenarios-title"
        title={copy.scenarios}
        subtitle={copy.scenariosHint}
        trailing={
          <span id="benchmark-run-warning" className="text-xs text-[var(--text-faint)]">
            {copy.runWarning}
          </span>
        }
      />
      <div id="benchmark-scenario-grid" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((s) => {
          const latest = latestByScenario.get(s.id);
          const colorVar = seriesVarByScenario.get(s.id) ?? SERIES_FALLBACK_VAR;
          const isRunning = runningId === s.id;
          return (
            <div
              id={`benchmark-scenario-${s.id}`}
              key={s.id}
              className={cn(
                CHART_PALETTE_CLASSES,
                "flex flex-col gap-2 rounded-[var(--radius-tile)] border border-[var(--border-hairline)] bg-[var(--surface-sunken)]/40 p-4"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: `var(${colorVar})` }}
                />
                <p
                  id={`benchmark-scenario-${s.id}-name`}
                  className="truncate text-sm font-semibold text-[var(--text-primary)]"
                  title={s.id}
                >
                  {s.id}
                </p>
              </div>
              <p
                id={`benchmark-scenario-${s.id}-summary`}
                className="text-xs text-[var(--text-muted)]"
              >
                {s.answers.destination} · {s.answers.duration_days}d ·{" "}
                {copy.pace[s.answers.pace]} · {copy.party[s.answers.party]} (
                {s.answers.party_size}) · {copy.budget[s.answers.budget_tier]}
              </p>
              <div
                id={`benchmark-scenario-${s.id}-vibes`}
                className="flex flex-wrap gap-1"
              >
                {(s.answers.vibe ?? []).map((v) => (
                  <Badge
                    id={`benchmark-scenario-${s.id}-vibe-${v}`}
                    key={v}
                    variant="secondary"
                    className="text-[10px]"
                  >
                    {copy.vibes[v]}
                  </Badge>
                ))}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span
                  id={`benchmark-scenario-${s.id}-latest`}
                  className="text-xs text-[var(--text-muted)]"
                >
                  {latest?.total != null
                    ? `${copy.latest}: ${Number(latest.total).toFixed(1)}`
                    : copy.noRunsYet}
                </span>
                <Button
                  id={`benchmark-scenario-${s.id}-run`}
                  size="sm"
                  disabled={runningId !== null}
                  onClick={() => onRun(s.id)}
                >
                  {isRunning ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
                  )}
                  {isRunning ? copy.running : copy.run}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </TabSurface>
  );
}

// ─── Trend chart ────────────────────────────────────────────────────────────

interface ChartPoint {
  runId: string;
  scenarioId: string;
  t: number;
  total: number;
  ranAt: string;
  judgeScore: number | null;
  x: number;
  y: number;
}

const CHART_W = 720;
const CHART_H = 240;
const PAD = { top: 14, right: 16, bottom: 26, left: 34 };

function TrendSection({
  copy,
  locale,
  runs,
  scenarioFilter,
  seriesVarByScenario,
}: {
  copy: Copy;
  locale: string;
  runs: BenchmarkRunRecord[];
  scenarioFilter: string;
  seriesVarByScenario: Map<string, string>;
}) {
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { series, allPoints } = useMemo(() => {
    const scored = runs
      .filter(
        (r) =>
          r.ok &&
          r.total != null &&
          (scenarioFilter === "all" || r.scenario_id === scenarioFilter)
      )
      .map((r) => ({
        runId: r.id ?? `${r.scenario_id}-${r.ran_at}`,
        scenarioId: r.scenario_id,
        t: new Date(r.ran_at).getTime(),
        total: Number(r.total),
        ranAt: r.ran_at,
        judgeScore: r.judge?.score ?? null,
      }))
      .sort((a, b) => a.t - b.t);

    if (scored.length === 0) return { series: [], allPoints: [] as ChartPoint[] };

    const tMin = scored[0].t;
    const tMax = scored[scored.length - 1].t;
    const span = Math.max(tMax - tMin, 1);
    const plotW = CHART_W - PAD.left - PAD.right;
    const plotH = CHART_H - PAD.top - PAD.bottom;

    const points: ChartPoint[] = scored.map((p) => ({
      ...p,
      x:
        scored.length === 1
          ? PAD.left + plotW / 2
          : PAD.left + ((p.t - tMin) / span) * plotW,
      y: PAD.top + (1 - p.total / 100) * plotH,
    }));

    const byScenario = new Map<string, ChartPoint[]>();
    for (const p of points) {
      const list = byScenario.get(p.scenarioId) ?? [];
      list.push(p);
      byScenario.set(p.scenarioId, list);
    }
    return {
      series: Array.from(byScenario.entries()).map(([scenarioId, pts]) => ({
        scenarioId,
        pts,
      })),
      allPoints: points,
    };
  }, [runs, scenarioFilter]);

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || allPoints.length === 0) return;
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * CHART_W;
      const py = ((e.clientY - rect.top) / rect.height) * CHART_H;
      let best: ChartPoint | null = null;
      let bestDist = Infinity;
      for (const p of allPoints) {
        const d = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      // generous hit target (~28px radius in viewBox units)
      setHover(bestDist <= 28 ** 2 ? best : null);
    },
    [allPoints]
  );

  const hasGray = series.some(
    (s) => (seriesVarByScenario.get(s.scenarioId) ?? SERIES_FALLBACK_VAR) === SERIES_FALLBACK_VAR
  );

  return (
    <TabSurface id="benchmark-trend" className="flex flex-col gap-3">
      <TabSurfaceTitle
        id="benchmark-trend-title"
        title={copy.trend}
        subtitle={copy.trendHint}
      />
      {allPoints.length === 0 ? (
        <TabEmptyState message={copy.trendEmpty} icon={<FlaskConical className="h-5 w-5" aria-hidden />} />
      ) : (
        <div id="benchmark-trend-chart-wrap" className={cn(CHART_PALETTE_CLASSES, "relative")}>
          <svg
            id="benchmark-trend-chart"
            ref={svgRef}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="h-auto w-full"
            role="img"
            aria-label={copy.trend}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            {/* recessive grid + y labels */}
            {[0, 25, 50, 75, 100].map((v) => {
              const y = PAD.top + (1 - v / 100) * (CHART_H - PAD.top - PAD.bottom);
              return (
                <g id={`benchmark-trend-grid-${v}`} key={v}>
                  <line
                    x1={PAD.left}
                    x2={CHART_W - PAD.right}
                    y1={y}
                    y2={y}
                    stroke="var(--border-hairline)"
                    strokeWidth={v === 0 ? 1.25 : 0.75}
                  />
                  <text
                    x={PAD.left - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={9}
                    fill="var(--text-faint)"
                  >
                    {v}
                  </text>
                </g>
              );
            })}
            {/* x labels: first + last run time */}
            <text
              id="benchmark-trend-x-min"
              x={PAD.left}
              y={CHART_H - 8}
              fontSize={9}
              fill="var(--text-faint)"
            >
              {fmtDate(allPoints[0].ranAt, locale)}
            </text>
            <text
              id="benchmark-trend-x-max"
              x={CHART_W - PAD.right}
              y={CHART_H - 8}
              textAnchor="end"
              fontSize={9}
              fill="var(--text-faint)"
            >
              {fmtDate(allPoints[allPoints.length - 1].ranAt, locale)}
            </text>
            {/* series lines + points */}
            {series.map(({ scenarioId, pts }) => {
              const colorVar = seriesVarByScenario.get(scenarioId) ?? SERIES_FALLBACK_VAR;
              const stroke = `var(${colorVar})`;
              const d = pts
                .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                .join(" ");
              return (
                <g id={`benchmark-trend-series-${scenarioId}`} key={scenarioId}>
                  {pts.length > 1 && (
                    <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
                  )}
                  {pts.map((p) => {
                    const isHover = hover?.runId === p.runId;
                    return (
                      <circle
                        id={`benchmark-trend-pt-${p.runId}`}
                        key={p.runId}
                        cx={p.x}
                        cy={p.y}
                        r={isHover ? 5 : 3}
                        fill={stroke}
                        stroke="var(--surface-raised)"
                        strokeWidth={isHover ? 2 : 1}
                      />
                    );
                  })}
                  {/* direct label at the last point when few series */}
                  {series.length <= 4 && (
                    <text
                      x={Math.min(pts[pts.length - 1].x + 6, CHART_W - PAD.right)}
                      y={pts[pts.length - 1].y - 6}
                      fontSize={9}
                      fill="var(--text-secondary)"
                    >
                      {scenarioLabel(scenarioId)}
                    </text>
                  )}
                </g>
              );
            })}
            {/* crosshair on hover */}
            {hover && (
              <line
                id="benchmark-trend-crosshair"
                x1={hover.x}
                x2={hover.x}
                y1={PAD.top}
                y2={CHART_H - PAD.bottom}
                stroke="var(--text-faint)"
                strokeWidth={0.75}
                strokeDasharray="3 3"
              />
            )}
          </svg>
          {hover && (
            <div
              id="benchmark-trend-tooltip"
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[11px] shadow-md"
              style={{
                left: `${(hover.x / CHART_W) * 100}%`,
                top: `${(Math.max(hover.y - 12, 0) / CHART_H) * 100}%`,
                transform: "translate(-50%, -100%)",
              }}
            >
              <p className="font-semibold text-[var(--text-primary)]">
                {scenarioLabel(hover.scenarioId)}
              </p>
              <p className="text-[var(--text-muted)]">
                {fmtDate(hover.ranAt, locale)} · {hover.total.toFixed(1)}/100
                {hover.judgeScore != null &&
                  ` · ${copy.colJudge} ${(hover.judgeScore * 100).toFixed(0)}`}
              </p>
            </div>
          )}
          {/* legend — always present for ≥2 series; single series is named by it too */}
          <ul id="benchmark-trend-legend" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {series.map(({ scenarioId }) => {
              const colorVar = seriesVarByScenario.get(scenarioId) ?? SERIES_FALLBACK_VAR;
              return (
                <li
                  id={`benchmark-trend-legend-${scenarioId}`}
                  key={scenarioId}
                  className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ background: `var(${colorVar})` }}
                  />
                  {scenarioLabel(scenarioId)}
                </li>
              );
            })}
            {hasGray && (
              <li id="benchmark-trend-legend-gray-note" className="text-[10px] text-[var(--text-faint)]">
                {copy.grayNote}
              </li>
            )}
          </ul>
        </div>
      )}
    </TabSurface>
  );
}

// ─── History table ──────────────────────────────────────────────────────────

function HistorySection({
  copy,
  locale,
  runs,
  allEmpty,
  scenarioIds,
  scenarioFilter,
  onScenarioFilter,
  seriesVarByScenario,
  expandedId,
  onToggleExpand,
  onDelete,
}: {
  copy: Copy;
  locale: string;
  runs: BenchmarkRunRecord[];
  allEmpty: boolean;
  scenarioIds: string[];
  scenarioFilter: string;
  onScenarioFilter: (v: string) => void;
  seriesVarByScenario: Map<string, string>;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <TabSurface id="benchmark-history" className="flex flex-col gap-3">
      <TabSurfaceTitle
        id="benchmark-history-title"
        title={copy.history}
        subtitle={copy.historyHint}
        trailing={
          <Select value={scenarioFilter} onValueChange={onScenarioFilter}>
            <SelectTrigger id="benchmark-history-filter" className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem id="benchmark-history-filter-all" value="all">
                {copy.allScenarios}
              </SelectItem>
              {scenarioIds.map((id) => (
                <SelectItem id={`benchmark-history-filter-${id}`} key={id} value={id}>
                  {scenarioLabel(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {allEmpty ? (
        <TabEmptyState
          message={copy.historyEmpty}
          hint={copy.historyEmptyHint}
          icon={<FlaskConical className="h-5 w-5" aria-hidden />}
        />
      ) : (
        <div id="benchmark-history-scroll" className="overflow-x-auto">
          <table id="benchmark-history-table" className="w-full min-w-[640px] border-collapse text-sm">
            <thead id="benchmark-history-thead">
              <tr className="border-b border-[var(--border-hairline)] text-left text-xs text-[var(--text-muted)]">
                <th id="benchmark-col-date" className="py-2 pr-3 font-medium">{copy.colDate}</th>
                <th id="benchmark-col-scenario" className="py-2 pr-3 font-medium">{copy.colScenario}</th>
                <th id="benchmark-col-source" className="py-2 pr-3 font-medium">{copy.colSource}</th>
                <th id="benchmark-col-score" className="py-2 pr-3 font-medium">{copy.colScore}</th>
                <th id="benchmark-col-judge" className="py-2 pr-3 font-medium">{copy.colJudge}</th>
                <th id="benchmark-col-status" className="py-2 pr-3 font-medium">{copy.colStatus}</th>
                <th id="benchmark-col-actions" className="py-2 font-medium" aria-label="actions" />
              </tr>
            </thead>
            <tbody id="benchmark-history-tbody">
              {runs.map((r) => {
                const rowId = r.id ?? `${r.scenario_id}-${r.ran_at}`;
                const expanded = expandedId === rowId;
                const colorVar = seriesVarByScenario.get(r.scenario_id) ?? SERIES_FALLBACK_VAR;
                return (
                  <RunRow
                    key={rowId}
                    copy={copy}
                    locale={locale}
                    run={r}
                    rowId={rowId}
                    colorVar={colorVar}
                    expanded={expanded}
                    onToggleExpand={() => onToggleExpand(rowId)}
                    onDelete={r.id ? () => onDelete(r.id!) : undefined}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TabSurface>
  );
}

function RunRow({
  copy,
  locale,
  run,
  rowId,
  colorVar,
  expanded,
  onToggleExpand,
  onDelete,
}: {
  copy: Copy;
  locale: string;
  run: BenchmarkRunRecord;
  rowId: string;
  colorVar: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <tr
        id={`benchmark-run-${rowId}`}
        className={cn(
          CHART_PALETTE_CLASSES,
          "cursor-pointer border-b border-[var(--border-hairline)] transition-colors hover:bg-[var(--surface-sunken)]/50"
        )}
        onClick={onToggleExpand}
      >
        <td id={`benchmark-run-${rowId}-date`} className="whitespace-nowrap py-2 pr-3 text-xs text-[var(--text-muted)]">
          {fmtDate(run.ran_at, locale)}
        </td>
        <td id={`benchmark-run-${rowId}-scenario`} className="py-2 pr-3">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(${colorVar})` }} />
            <span className="truncate text-xs font-medium text-[var(--text-primary)]">
              {scenarioLabel(run.scenario_id)}
            </span>
          </span>
        </td>
        <td id={`benchmark-run-${rowId}-source`} className="py-2 pr-3">
          <Badge variant="secondary" className="text-[10px] uppercase">{run.source}</Badge>
        </td>
        <td id={`benchmark-run-${rowId}-score`} className="py-2 pr-3">
          {run.total != null ? (
            <span className="flex items-center gap-2">
              <span className="w-10 text-right text-xs font-semibold tabular-nums text-[var(--text-primary)]">
                {Number(run.total).toFixed(1)}
              </span>
              <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Number(run.total)}%`, background: `var(${colorVar})` }}
                />
              </span>
            </span>
          ) : (
            <span className="text-xs text-[var(--text-faint)]">—</span>
          )}
        </td>
        <td id={`benchmark-run-${rowId}-judge`} className="py-2 pr-3 text-xs">
          {run.judge ? (
            <span className={cn("font-medium", run.judge.pass ? "text-[var(--status-settled)]" : "text-[var(--status-blocked)]")}>
              {(run.judge.score * 100).toFixed(0)} · {run.judge.pass ? copy.judgePass : copy.judgeFail}
            </span>
          ) : (
            <span className="text-[var(--text-faint)]">{copy.judgeSkipped}</span>
          )}
        </td>
        <td id={`benchmark-run-${rowId}-status`} className="py-2 pr-3 text-xs">
          {run.ok ? (
            <span className="text-[var(--text-muted)]">{copy.statusOk}</span>
          ) : (
            <span className="font-medium text-[var(--status-blocked)]">{run.failure_reason}</span>
          )}
        </td>
        <td id={`benchmark-run-${rowId}-actions`} className="py-2 text-right">
          <span className="inline-flex items-center gap-1">
            {onDelete && (
              <Button
                id={`benchmark-run-${rowId}-delete`}
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-[var(--text-faint)] hover:text-[var(--status-blocked)]"
                aria-label="delete run"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
            <ChevronDown
              aria-hidden
              className={cn("h-4 w-4 text-[var(--text-faint)] transition-transform", expanded && "rotate-180")}
            />
          </span>
        </td>
      </tr>
      {expanded && (
        <tr id={`benchmark-run-${rowId}-details`} className="border-b border-[var(--border-hairline)] bg-[var(--surface-sunken)]/30">
          <td colSpan={7} className="px-2 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div id={`benchmark-run-${rowId}-metrics`}>
                <p className="mb-2 text-xs font-semibold text-[var(--text-primary)]">{copy.metrics}</p>
                {run.metrics ? (
                  <ul className="flex flex-col gap-1.5">
                    {METRIC_IDS.map((m) => {
                      const v = run.metrics?.[m];
                      if (v == null) return null;
                      return (
                        <li id={`benchmark-run-${rowId}-metric-${m}`} key={m} className="flex items-center gap-2 text-xs">
                          <span className="w-24 shrink-0 text-[var(--text-muted)]">{copy.metricNames[m]}</span>
                          <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                            <span
                              className="block h-full rounded-full bg-[var(--accent-line)]"
                              style={{ width: `${Math.round(v * 100)}%` }}
                            />
                          </span>
                          <span className="w-8 text-right tabular-nums text-[var(--text-primary)]">
                            {Math.round(v * 100)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--text-faint)]">—</p>
                )}
                {run.stats && (
                  <p id={`benchmark-run-${rowId}-stats`} className="mt-2 text-[11px] text-[var(--text-faint)]">
                    {copy.statsLine(run.stats)}
                  </p>
                )}
              </div>
              <div id={`benchmark-run-${rowId}-judge-detail`}>
                <p className="mb-2 text-xs font-semibold text-[var(--text-primary)]">{copy.judgeVerdict}</p>
                {run.judge ? (
                  <>
                    <ul className="flex flex-col gap-1.5">
                      {Object.entries(run.judge.aspects).map(([k, v]) => (
                        <li id={`benchmark-run-${rowId}-aspect-${k}`} key={k} className="flex items-center gap-2 text-xs">
                          <span className="w-24 shrink-0 text-[var(--text-muted)]">
                            {copy.aspectNames[k as keyof Copy["aspectNames"]] ?? k}
                          </span>
                          <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                            <span
                              className="block h-full rounded-full bg-[var(--accent-warm)]"
                              style={{ width: `${Math.round(v * 100)}%` }}
                            />
                          </span>
                          <span className="w-8 text-right tabular-nums text-[var(--text-primary)]">
                            {Math.round(v * 100)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p id={`benchmark-run-${rowId}-judge-reasoning`} className="mt-2 text-[11px] italic text-[var(--text-muted)]">
                      “{run.judge.reasoning}”
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-[var(--text-faint)]">{copy.judgeSkipped}</p>
                )}
                <p id={`benchmark-run-${rowId}-meta`} className="mt-2 break-all text-[10px] text-[var(--text-faint)]">
                  {copy.runDetails}: git={run.git_rev ?? "—"} · elapsed=
                  {(run.elapsed_ms / 1000).toFixed(1)}s · template={run.template_id ?? "—"} · version=
                  {run.version_id ?? "—"}
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Custom run dialog ──────────────────────────────────────────────────────

const VIBE_OPTIONS = ["relaxed", "adventure", "culture", "foodie", "nightlife", "nature"] as const;

function CustomRunDialog({
  copy,
  open,
  onOpenChange,
  disabled,
  onSubmit,
}: {
  copy: Copy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  onSubmit: (
    scenario: { answers: BenchmarkAnswers; startDate?: string },
    judge: boolean
  ) => void;
}) {
  const [destination, setDestination] = useState("");
  const [durationDays, setDurationDays] = useState(4);
  const [party, setParty] = useState<BenchmarkAnswers["party"]>("friends");
  const [partySize, setPartySize] = useState(4);
  const [budget, setBudget] = useState<BenchmarkAnswers["budget_tier"]>("mid");
  const [pace, setPace] = useState<BenchmarkAnswers["pace"]>("balanced");
  const [vibes, setVibes] = useState<Set<(typeof VIBE_OPTIONS)[number]>>(new Set(["adventure"]));
  const [mustHaves, setMustHaves] = useState("");
  const [startDate, setStartDate] = useState("");
  const [judge, setJudge] = useState(true);

  const valid = destination.trim().length >= 2 && durationDays >= 1 && durationDays <= 30;

  function toggleVibe(v: (typeof VIBE_OPTIONS)[number]) {
    setVibes((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function submit() {
    if (!valid) return;
    onSubmit(
      {
        answers: {
          destination: destination.trim(),
          duration_days: durationDays,
          party,
          party_size: partySize,
          budget_tier: budget,
          pace,
          vibe: Array.from(vibes),
          must_haves: mustHaves.trim() || null,
        },
        startDate: startDate || undefined,
      },
      judge
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="benchmark-custom-dialog" className="max-w-lg">
        <DialogHeader id="benchmark-custom-dialog-header">
          <DialogTitle id="benchmark-custom-dialog-title">{copy.customTitle}</DialogTitle>
          <DialogDescription id="benchmark-custom-dialog-desc">
            {copy.customDescription}
          </DialogDescription>
        </DialogHeader>

        <div id="benchmark-custom-form" className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="benchmark-f-destination">{copy.fDestination}</Label>
            <Input
              id="benchmark-f-destination"
              value={destination}
              placeholder={copy.fDestinationPh}
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="benchmark-f-duration">{copy.fDuration}</Label>
              <Input
                id="benchmark-f-duration"
                type="number"
                min={1}
                max={30}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="benchmark-f-party-size">{copy.fPartySize}</Label>
              <Input
                id="benchmark-f-party-size"
                type="number"
                min={1}
                max={20}
                value={partySize}
                onChange={(e) => setPartySize(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="benchmark-f-start-date">{copy.fStartDate}</Label>
              <Input
                id="benchmark-f-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="benchmark-f-party">{copy.fParty}</Label>
              <Select value={party} onValueChange={(v) => setParty(v as BenchmarkAnswers["party"])}>
                <SelectTrigger id="benchmark-f-party" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(copy.party) as Array<keyof Copy["party"]>).map((k) => (
                    <SelectItem id={`benchmark-f-party-${k}`} key={k} value={k}>
                      {copy.party[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="benchmark-f-budget">{copy.fBudget}</Label>
              <Select value={budget} onValueChange={(v) => setBudget(v as BenchmarkAnswers["budget_tier"])}>
                <SelectTrigger id="benchmark-f-budget" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(copy.budget) as Array<keyof Copy["budget"]>).map((k) => (
                    <SelectItem id={`benchmark-f-budget-${k}`} key={k} value={k}>
                      {copy.budget[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="benchmark-f-pace">{copy.fPace}</Label>
              <Select value={pace} onValueChange={(v) => setPace(v as BenchmarkAnswers["pace"])}>
                <SelectTrigger id="benchmark-f-pace" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(copy.pace) as Array<keyof Copy["pace"]>).map((k) => (
                    <SelectItem id={`benchmark-f-pace-${k}`} key={k} value={k}>
                      {copy.pace[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label id="benchmark-f-vibes-label">{copy.fVibes}</Label>
            <div id="benchmark-f-vibes" className="flex flex-wrap gap-1.5" role="group" aria-labelledby="benchmark-f-vibes-label">
              {VIBE_OPTIONS.map((v) => {
                const active = vibes.has(v);
                return (
                  <button
                    id={`benchmark-f-vibe-${v}`}
                    key={v}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleVibe(v)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      active
                        ? "border-transparent bg-[var(--accent-line)] text-white"
                        : "border-[var(--border-hairline)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]/60"
                    )}
                  >
                    {copy.vibes[v]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="benchmark-f-must-haves">{copy.fMustHaves}</Label>
            <Textarea
              id="benchmark-f-must-haves"
              rows={2}
              value={mustHaves}
              placeholder={copy.fMustHavesPh}
              onChange={(e) => setMustHaves(e.target.value)}
            />
          </div>

          <label
            id="benchmark-f-judge-row"
            htmlFor="benchmark-f-judge"
            className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--border-hairline)] px-3 py-2"
          >
            <input
              id="benchmark-f-judge"
              type="checkbox"
              checked={judge}
              onChange={(e) => setJudge(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm text-[var(--text-primary)]">{copy.fJudge}</span>
              <span className="block text-xs text-[var(--text-muted)]">{copy.fJudgeHint}</span>
            </span>
          </label>
        </div>

        <DialogFooter id="benchmark-custom-dialog-footer">
          <Button id="benchmark-custom-cancel" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.cancel}
          </Button>
          <Button id="benchmark-custom-submit" disabled={!valid || disabled} onClick={submit}>
            <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
            {copy.startRun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

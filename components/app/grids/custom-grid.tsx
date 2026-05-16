"use client";

import { useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import { GridTileError } from "@/components/app/grids/grid-tile";
import type { CustomGrid as CustomGridData } from "@/app/api/app/trips/[tripId]/custom-grids/route";

interface Props {
  tripId: string;
  grid: CustomGridData;
  onChange: (next: CustomGridData) => void;
  onDelete: (id: string) => void;
}

/**
 * Renders a custom bento tile driven by an agent's output. Today supports
 * the `price_tracker` shape produced by `flight-price-tracker`; new shapes
 * (summary, list) plug in as additional render branches below.
 */
export function CustomGrid({ tripId, grid, onChange, onDelete }: Props) {
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      const res = await appFetchJson<{ grid: CustomGridData }>(
        `/api/app/trips/${tripId}/custom-grids/${grid.id}/run`,
        { method: "POST" },
      );
      onChange(res.grid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${grid.title}"?`)) return;
    setDeleting(true);
    try {
      await appFetchJson(`/api/app/trips/${tripId}/custom-grids/${grid.id}`, {
        method: "DELETE",
      });
      onDelete(grid.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  if (error) return <GridTileError message={error} onRetry={() => setError(null)} />;

  const output = grid.lastOutput;
  const hasRun = grid.lastStatus === "success" && output;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2 text-[11px] text-[var(--text-muted)]">
        <div className="min-w-0">
          <div className="truncate font-medium text-[var(--text-secondary)]">
            {grid.title}
          </div>
          <div className="truncate">
            Every {grid.frequencyHours}h ·{" "}
            {grid.lastRunAt
              ? `Last run ${formatRelative(grid.lastRunAt)}`
              : "Not yet run"}
          </div>
          <div className="mt-1">
            <AutonomyChip tripId={tripId} grid={grid} onChange={onChange} />
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            disabled={running}
            onClick={runNow}
            className="rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {running ? "Running…" : "Run now"}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={remove}
            className="rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)] hover:border-[var(--status-blocked)] hover:text-[var(--status-blocked)] disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      </div>

      {!hasRun && grid.lastStatus === "failed" && (
        <div className="rounded-md border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
          Last run failed: {grid.lastError ?? "unknown error"}
        </div>
      )}

      {!hasRun && grid.lastStatus !== "failed" && (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-[var(--border-hairline)] p-4 text-center text-xs text-[var(--text-muted)]">
          Waiting for the first run. Click <strong className="px-1">Run now</strong> to fetch data immediately.
        </div>
      )}

      {hasRun && grid.agentType === "flight_price_tracker" && (
        <FlightPriceOutput output={output as Record<string, unknown>} />
      )}

      {hasRun && grid.agentType === "weather_forecast" && (
        <WeatherForecastOutput output={output as Record<string, unknown>} />
      )}

      {hasRun && grid.agentType === "chat_digest" && (
        <ChatDigestOutput output={output as Record<string, unknown>} />
      )}

      {hasRun && grid.agentType === "itinerary_drafter" && (
        <ItineraryDrafterOutput tripId={tripId} output={output as Record<string, unknown>} />
      )}
    </div>
  );
}

// ─── Output renderers ────────────────────────────────────────────────────────

function FlightPriceOutput({ output }: { output: Record<string, unknown> }) {
  const currency = (output.currency as string) ?? "USD";
  const price = output.cheapestPrice as number;
  const airline = output.cheapestAirline as string;
  const stops = output.cheapestStops as number;
  const duration = output.cheapestDurationMinutes as number;
  const route = output.route as string;
  const departDate = output.departDate as string;
  const returnDate = output.returnDate as string | null;
  const budget = output.budget as number | null;
  const underBudget = output.underBudget as boolean | null;
  const bookingUrl = output.bookingUrl as string;
  const summary = output.summary as string;
  const quotes = (output.quotes as Array<{ airline: string; price: number; stops: number }>) ?? [];

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
          {route} · {departDate}
          {returnDate ? ` → ${returnDate}` : ""}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-[var(--text-primary)]">
            {currency} {price}
          </span>
          {budget != null && (
            <span
              className={
                underBudget
                  ? "rounded-full bg-[var(--status-ok-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-ok)]"
                  : "rounded-full bg-[var(--status-blocked-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-blocked)]"
              }
            >
              {underBudget ? "Under budget" : `Over ${currency} ${budget}`}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          {airline} · {stops === 0 ? "Direct" : `${stops} stop${stops > 1 ? "s" : ""}`} ·{" "}
          {formatDuration(duration)}
        </div>
      </div>

      {summary && (
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{summary}</p>
      )}

      {quotes.length > 1 && (
        <div className="mt-auto">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Other options
          </div>
          <ul className="mt-1 space-y-1 text-xs">
            {quotes
              .slice()
              .sort((a, b) => a.price - b.price)
              .slice(1, 4)
              .map((q, i) => (
                <li
                  key={`${q.airline}-${i}`}
                  className="flex items-center justify-between text-[var(--text-muted)]"
                >
                  <span className="truncate">{q.airline}</span>
                  <span>
                    {currency} {q.price} ·{" "}
                    {q.stops === 0 ? "Direct" : `${q.stops} stop${q.stops > 1 ? "s" : ""}`}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {bookingUrl && (
        <a
          href={bookingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[10px] uppercase tracking-wide text-[var(--accent-line)] hover:underline"
        >
          Book ↗
        </a>
      )}
    </div>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

const AUTONOMY_LABEL: Record<CustomGridData["autonomy"], string> = {
  propose_only: "Propose only",
  auto_apply_with_undo: "Auto + undo",
  auto_apply: "Auto",
};

const AUTONOMY_NEXT: Record<CustomGridData["autonomy"], CustomGridData["autonomy"]> = {
  propose_only: "auto_apply_with_undo",
  auto_apply_with_undo: "auto_apply",
  auto_apply: "propose_only",
};

/**
 * Inline cycle button for the autonomy dial. Click cycles through the three
 * levels and PATCHes the row. Best-effort — on failure we revert locally and
 * let the user retry. The chip is hidden for monitor-mode agents (flight,
 * weather, chat_digest) because they have no proposals to apply.
 */
function AutonomyChip({
  tripId,
  grid,
  onChange,
}: {
  tripId: string;
  grid: CustomGridData;
  onChange: (next: CustomGridData) => void;
}) {
  const [saving, setSaving] = useState(false);

  // Only propose-mode agents act on autonomy. Hide the chip for the others.
  if (grid.agentType !== "itinerary_drafter") return null;

  async function cycle() {
    const next = AUTONOMY_NEXT[grid.autonomy];
    const prev = grid.autonomy;
    setSaving(true);
    onChange({ ...grid, autonomy: next });
    try {
      await appFetchJson(`/api/app/trips/${tripId}/custom-grids/${grid.id}`, {
        method: "PATCH",
        body: JSON.stringify({ autonomy: next }),
      });
    } catch {
      onChange({ ...grid, autonomy: prev });
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={cycle}
      className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:border-[var(--accent-line)] hover:text-[var(--accent-line)] disabled:opacity-50"
      title="Click to change autonomy"
    >
      ✦ {AUTONOMY_LABEL[grid.autonomy]}
    </button>
  );
}

interface DayForecast {
  date: string;
  condition: string;
  highTempC: number;
  lowTempC: number;
  precipChance: number;
}

function WeatherForecastOutput({ output }: { output: Record<string, unknown> }) {
  const location = output.location as string;
  const units = (output.units as "c" | "f") ?? "c";
  const summary = output.summary as string;
  const days = (output.days as DayForecast[]) ?? [];
  const rainyDates = (output.rainyDates as string[]) ?? [];

  const today = days[0];
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
          {location}
        </div>
        {today && (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-[var(--text-primary)]">
              {formatTemp(today.highTempC, units)}
            </span>
            <span className="text-sm text-[var(--text-muted)]">
              / {formatTemp(today.lowTempC, units)}
            </span>
            <span className="text-xs text-[var(--text-muted)]">· {today.condition}</span>
          </div>
        )}
        {rainyDates.length > 0 && (
          <div className="mt-1 inline-block rounded-full bg-[var(--status-blocked-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--status-blocked)]">
            Rain on {rainyDates.length} day{rainyDates.length > 1 ? "s" : ""}
          </div>
        )}
      </div>

      {summary && (
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{summary}</p>
      )}

      {days.length > 1 && (
        <div className="mt-auto">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Forecast
          </div>
          <ul className="mt-1 grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-3">
            {days.slice(0, 6).map((d) => (
              <li
                key={d.date}
                className="flex items-center justify-between rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[var(--text-muted)]"
              >
                <span className="truncate">{shortDate(d.date)}</span>
                <span className="font-medium text-[var(--text-secondary)]">
                  {formatTemp(d.highTempC, units)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChatDigestOutput({ output }: { output: Record<string, unknown> }) {
  const summary = (output.summary as string) ?? "";
  const decisions = (output.decisions as string[]) ?? [];
  const openQuestions = (output.openQuestions as string[]) ?? [];
  const since = output.sinceLabel as string | undefined;

  return (
    <div className="flex flex-1 flex-col gap-3">
      {since && (
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{since}</div>
      )}
      {summary && (
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{summary}</p>
      )}
      {decisions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Decisions
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--text-secondary)]">
            {decisions.map((d, i) => (
              <li key={`d-${i}`}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {openQuestions.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
            Open questions
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--text-secondary)]">
            {openQuestions.map((q, i) => (
              <li key={`q-${i}`}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatTemp(c: number, units: "c" | "f"): string {
  if (units === "f") return `${Math.round(c * 9 / 5 + 32)}°F`;
  return `${Math.round(c)}°C`;
}

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

interface DraftedDay {
  date: string;
  title: string;
  suggestions: Array<{ category: string; text: string }>;
}

function ItineraryDrafterOutput({
  tripId,
  output,
}: {
  tripId: string;
  output: Record<string, unknown>;
}) {
  const destination = output.destination as string;
  const overview = output.overview as string;
  const days = (output.days as DraftedDay[]) ?? [];
  const created = (output.created as number) ?? 0;
  const skipped = (output.skipped as number) ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
          {destination} · {days.length} day{days.length === 1 ? "" : "s"}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>
            {created} new suggestion{created === 1 ? "" : "s"} added to Ideas
          </span>
          {skipped > 0 && <span>· {skipped} skipped (duplicates)</span>}
        </div>
      </div>

      {overview && (
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{overview}</p>
      )}

      <ul className="space-y-2 overflow-y-auto pr-1">
        {days.slice(0, 4).map((day) => (
          <li
            key={day.date}
            className="rounded-md border border-[var(--border-hairline)] px-2.5 py-2"
          >
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              {shortDate(day.date)}
            </div>
            <div className="text-xs font-medium text-[var(--text-primary)]">{day.title}</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-[var(--text-muted)]">
              {day.suggestions.slice(0, 3).map((s, i) => (
                <li key={`${day.date}-${i}`}>{s.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <a
        href={`/app/trips/${tripId}/ideas`}
        className="mt-auto text-[10px] uppercase tracking-wide text-[var(--accent-line)] hover:underline"
      >
        Review in Ideas ↗
      </a>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

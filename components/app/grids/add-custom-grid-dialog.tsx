"use client";

import { useEffect, useState } from "react";
import { appFetchJson } from "@/lib/app-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { PublicAgent } from "@/services/agents/registry";
import type { CustomGrid } from "@/app/api/app/trips/[tripId]/custom-grids/route";
import type { AgentConfigField } from "@/services/agents/types";

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (grid: CustomGrid) => void;
}

/**
 * Two-step dialog: 1) pick an agent from the registry, 2) fill its config
 * fields + grid title. On submit, POSTs to /api/app/trips/.../custom-grids
 * and then kicks off an immediate run so the tile shows data right away.
 */
export function AddCustomGridDialog({ tripId, open, onOpenChange, onCreated }: Props) {
  const [agents, setAgents] = useState<PublicAgent[] | null>(null);
  const [selected, setSelected] = useState<PublicAgent | null>(null);
  const [title, setTitle] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await appFetchJson<{ agents: PublicAgent[] }>("/api/app/agents");
        if (!cancelled) setAgents(res.agents);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load agents");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelected(null);
      setTitle("");
      setConfig({});
      setError(null);
      setSubmitting(false);
    }
    onOpenChange(next);
  }

  function pickAgent(agent: PublicAgent) {
    setSelected(agent);
    setTitle(agent.label);
    setConfig({ ...(agent.defaultConfig as Record<string, unknown>) });
  }

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await appFetchJson<{ grid: CustomGrid }>(
        `/api/app/trips/${tripId}/custom-grids`,
        {
          method: "POST",
          body: JSON.stringify({
            agentType: selected.type,
            title: title.trim() || selected.label,
            config,
          }),
        },
      );

      let final = created.grid;
      try {
        const ran = await appFetchJson<{ grid: CustomGrid }>(
          `/api/app/trips/${tripId}/custom-grids/${final.id}/run`,
          { method: "POST" },
        );
        if (ran.grid) final = ran.grid;
      } catch {
        // The grid is created; first run can be retried from the tile.
      }

      onCreated(final);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{selected ? `Configure ${selected.label}` : "Add a custom grid"}</DialogTitle>
          <DialogDescription>
            {selected
              ? "An AI agent will keep this tile fresh on a schedule."
              : "Pick an agent to power a new bento tile."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
            {error}
          </div>
        )}

        {!selected && (
          <div className="grid gap-2">
            {agents == null && <div className="text-sm text-[var(--text-muted)]">Loading agents…</div>}
            {agents?.map((a) => (
              <button
                key={a.type}
                type="button"
                onClick={() => pickAgent(a)}
                className="flex items-start gap-3 rounded-lg border border-[var(--border-hairline)] p-3 text-left hover:border-[var(--accent-line)]"
              >
                <span className="text-2xl">{a.icon}</span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">
                    {a.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-muted)]">
                    {a.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Tile title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-base)] px-3 py-2 text-sm"
              />
            </div>
            {selected.configFields.map((f) => (
              <ConfigFieldInput
                key={f.name}
                field={f}
                value={config[f.name]}
                onChange={(v) => setConfig((prev) => ({ ...prev, [f.name]: v }))}
              />
            ))}
          </div>
        )}

        <DialogFooter>
          {selected && (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-sm hover:border-[var(--border-strong)]"
            >
              Back
            </button>
          )}
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={submit}
            className="rounded-md bg-[var(--accent-line)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Add grid"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigFieldInput({
  field,
  value,
  onChange,
}: {
  field: AgentConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const inputClass =
    "rounded-md border border-[var(--border-hairline)] bg-[var(--surface-base)] px-3 py-2 text-sm";
  return (
    <div className="grid gap-1">
      <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {field.label}
      </label>
      {field.type === "text" && (
        <input
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
      {field.type === "number" && (
        <input
          type="number"
          value={(value as number | string) ?? ""}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Number(v));
          }}
          className={inputClass}
        />
      )}
      {field.type === "date" && (
        <input
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        />
      )}
      {field.type === "select" && (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

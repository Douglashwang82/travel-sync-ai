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
import type { AgentAutonomy, AgentConfigField } from "@/services/agents/types";

interface Props {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (grid: CustomGrid) => void;
  /**
   * Open straight into the config step for a known agent, with fields
   * pre-filled. Used by the "drag a chat message onto the rail" flow when an
   * immediate create failed (e.g. a required field couldn't be derived).
   */
  prefill?: { agentType: string; title?: string; config?: Record<string, unknown> } | null;
}

/**
 * Two-step dialog: 1) pick an agent from the registry, 2) fill its config
 * fields + grid title. On submit, POSTs to /api/app/trips/.../custom-grids
 * and then kicks off an immediate run so the tile shows data right away.
 */
export function AddCustomGridDialog({ tripId, open, onOpenChange, onCreated, prefill }: Props) {
  const [agents, setAgents] = useState<PublicAgent[] | null>(null);
  const [selected, setSelected] = useState<PublicAgent | null>(null);
  const [title, setTitle] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [autonomy, setAutonomy] = useState<AgentAutonomy>("propose_only");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await appFetchJson<{ agents: PublicAgent[] }>("/api/app/agents");
        if (cancelled) return;
        setAgents(res.agents);
        // If opened via a drag-drop prefill, jump straight to the config step
        // for the named agent and merge the extracted config over its defaults.
        if (prefill) {
          const agent = res.agents.find((a) => a.type === prefill.agentType);
          if (agent) {
            setSelected(agent);
            setTitle(prefill.title?.trim() || agent.label);
            setConfig({
              ...(agent.defaultConfig as Record<string, unknown>),
              ...(prefill.config ?? {}),
            });
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "載入代理失敗");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, prefill]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelected(null);
      setTitle("");
      setConfig({});
      setAutonomy("propose_only");
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
            autonomy,
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
      setError(err instanceof Error ? err.message : "建立失敗");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{selected ? `設定 ${selected.label}` : "新增自訂格"}</DialogTitle>
          <DialogDescription>
            {selected
              ? "AI 代理會依照排程自動更新這個格子。"
              : "選擇一個代理，為新的 bento 格子提供內容。"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-[var(--status-blocked)] bg-[var(--status-blocked-soft)] px-3 py-2 text-xs text-[var(--status-blocked)]">
            {error}
          </div>
        )}

        {!selected && (
          <div className="grid gap-2">
            {agents == null && <div className="text-sm text-[var(--text-muted)]">正在載入代理…</div>}
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
                格子標題
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
            {selected.mode === "propose" && (
              <AutonomyPicker value={autonomy} onChange={setAutonomy} />
            )}
          </div>
        )}

        <DialogFooter>
          {selected && (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-sm hover:border-[var(--border-strong)]"
            >
              返回
            </button>
          )}
          <button
            type="button"
            disabled={!selected || submitting}
            onClick={submit}
            className="rounded-md bg-[var(--accent-line)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "建立中…" : "新增格子"}
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

const AUTONOMY_OPTIONS: Array<{
  value: AgentAutonomy;
  label: string;
  hint: string;
}> = [
  {
    value: "propose_only",
    label: "僅提出建議",
    hint: "建議會出現在「點子」中。除非有人確認，否則不會加入旅程。",
  },
  {
    value: "auto_apply_with_undo",
    label: "自動套用（可復原）",
    hint: "建議會自動加入待辦看板，並提供「忽略」按鈕可以移除。",
  },
  {
    value: "auto_apply",
    label: "自動套用",
    hint: "建議會直接加入待辦看板，不另行通知。請充分信任這個代理。",
  },
];

function AutonomyPicker({
  value,
  onChange,
}: {
  value: AgentAutonomy;
  onChange: (next: AgentAutonomy) => void;
}) {
  return (
    <div className="grid gap-2">
      <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
        自主權
      </label>
      <div className="grid gap-1">
        {AUTONOMY_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-xs ${
              value === opt.value
                ? "border-[var(--accent-line)] bg-[var(--accent-line-soft)]"
                : "border-[var(--border-hairline)] hover:border-[var(--border-strong)]"
            }`}
          >
            <input
              type="radio"
              name="agent-autonomy"
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="block font-semibold text-[var(--text-primary)]">{opt.label}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

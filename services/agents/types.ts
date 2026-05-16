import type { z } from "zod";

export type AgentOutputKind =
  | "price_tracker"   // numeric value over time + comparison
  | "summary"         // markdown summary
  | "list";           // bulleted items

/**
 * Collaboration mode — how the agent interacts with the trip and its members.
 *
 *  - `monitor`: read-only. Polls external state, writes only to its own
 *    custom-grid output. Never mutates trip rows.
 *  - `propose`: drafts ghost items into a "pending" lane that a human must
 *    explicitly Confirm / Edit / Dismiss before they become committed state.
 *  - `assist`: on-demand. Triggered by a human action (palette command,
 *    button, slash). Produces a single transient output; no schedule.
 *
 * The bento frame shows the mode as a small chip; this is what users read to
 * know whether something is "just an observation" vs. "needs my decision".
 */
export type AgentMode = "monitor" | "propose" | "assist";

/**
 * Per-grid trust dial. Controls whether a `propose`-mode agent only writes
 * to the ghost lane (`propose_only`, default) or also applies its proposals
 * to committed state. `monitor`-mode agents ignore this — they have nothing
 * to apply.
 */
export type AgentAutonomy = "propose_only" | "auto_apply_with_undo" | "auto_apply";

export interface AgentRunContext {
  tripId: string;
  customGridId: string;
  config: unknown;
  autonomy: AgentAutonomy;
}

export interface AgentRunResult {
  outputKind: AgentOutputKind;
  output: Record<string, unknown>;
}

export interface AgentDefinition<Config = unknown> {
  type: string;                              // registry key, persisted to DB
  label: string;                             // human-readable name in pickers
  description: string;                       // shown in the "Add grid" dialog
  icon: string;                              // single emoji for the tile header
  mode: AgentMode;                           // collaboration contract — see AgentMode docs
  defaultFrequencyHours: number;
  configSchema: z.ZodType<Config>;           // validates `config` on create
  defaultConfig: Config;                     // initial values for the form
  configFields: AgentConfigField[];          // metadata to render the form
  /**
   * Optional list of agent types this one reads from. The cron sweeper runs
   * dependencies before dependents on the same tick so `propose`/`assist`
   * agents can use the latest `monitor` outputs.
   */
  dependsOn?: string[];
  run(ctx: AgentRunContext): Promise<AgentRunResult>;
}

export type AgentConfigField =
  | {
      name: string;
      label: string;
      type: "text";
      placeholder?: string;
      required?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "number";
      placeholder?: string;
      min?: number;
      max?: number;
      required?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "date";
      required?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      required?: boolean;
    };

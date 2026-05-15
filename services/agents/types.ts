import type { z } from "zod";

export type AgentOutputKind =
  | "price_tracker"   // numeric value over time + comparison
  | "summary"         // markdown summary
  | "list";           // bulleted items

export interface AgentRunContext {
  tripId: string;
  customGridId: string;
  config: unknown;
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
  defaultFrequencyHours: number;
  configSchema: z.ZodType<Config>;           // validates `config` on create
  defaultConfig: Config;                     // initial values for the form
  configFields: AgentConfigField[];          // metadata to render the form
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

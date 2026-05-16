import type { AgentDefinition, AgentMode } from "./types";
import { flightPriceTracker } from "./flight-price-tracker";

const AGENTS: AgentDefinition[] = [flightPriceTracker as AgentDefinition];

const AGENT_MAP = new Map(AGENTS.map((a) => [a.type, a]));

export function listAgents(): AgentDefinition[] {
  return AGENTS;
}

export function getAgent(type: string): AgentDefinition | null {
  return AGENT_MAP.get(type) ?? null;
}

/**
 * Strip the run() and Zod schema from an agent so it can be sent to the
 * browser. Only the fields needed to render the picker + config form.
 */
export interface PublicAgent {
  type: string;
  label: string;
  description: string;
  icon: string;
  mode: AgentMode;
  defaultFrequencyHours: number;
  configFields: AgentDefinition["configFields"];
  defaultConfig: unknown;
}

export function publicAgents(): PublicAgent[] {
  return AGENTS.map((a) => ({
    type: a.type,
    label: a.label,
    description: a.description,
    icon: a.icon,
    mode: a.mode,
    defaultFrequencyHours: a.defaultFrequencyHours,
    configFields: a.configFields,
    defaultConfig: a.defaultConfig,
  }));
}

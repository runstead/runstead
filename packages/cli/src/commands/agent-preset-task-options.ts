import type { CreateLocalAgentTaskOptions } from "../local-agent-types.js";
import type { ResolvedConfiguredLocalAgentPreset } from "../local-agent-presets.js";

import {
  agentBudgetTaskOptions,
  type AgentBudgetCliOptions
} from "./agent-budget-options.js";
import {
  agentTaskModelOptions,
  type AgentTaskModelCliOptions
} from "./agent-task-options.js";

export type AgentPresetTaskCliOptions = AgentBudgetCliOptions &
  AgentTaskModelCliOptions;

export function agentPresetTaskOptions(
  options: AgentPresetTaskCliOptions,
  resolvedPreset: ResolvedConfiguredLocalAgentPreset
): Pick<
  CreateLocalAgentTaskOptions,
  | "prompt"
  | "preset"
  | "provider"
  | "model"
  | "baseUrl"
  | "mode"
  | "checkpoint"
  | "maxTurns"
  | "maxToolCalls"
  | "maxFailedToolCalls"
> {
  return {
    prompt: resolvedPreset.prompt,
    preset: resolvedPreset.preset.id,
    ...agentTaskModelOptions(options, resolvedPreset.model),
    mode: resolvedPreset.preset.mode,
    checkpoint: resolvedPreset.preset.checkpoint,
    ...agentBudgetTaskOptions(options, {
      maxTurns: resolvedPreset.preset.maxTurns,
      maxToolCalls: resolvedPreset.preset.maxToolCalls,
      maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
    })
  };
}

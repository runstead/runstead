import type { CreateLocalAgentTaskOptions } from "../local-agent-types.js";
import type { ResolvedConfiguredLocalAgentPreset } from "../local-agent-presets.js";
import type { CommandVerifierInput } from "../verifier-evidence.js";

import {
  agentBudgetTaskOptions,
  type AgentBudgetCliOptions
} from "./agent-budget-options.js";
import { parseLocalAgentMode } from "./agent-run-options.js";
import {
  agentTaskModelOptions,
  type AgentTaskModelCliOptions
} from "./agent-task-options.js";

export interface AgentRunTaskCliOptions
  extends AgentBudgetCliOptions, AgentTaskModelCliOptions {
  mode: string;
  allowed: string[];
  denied: string[];
}

export function agentRunTaskOptions(input: {
  options: AgentRunTaskCliOptions;
  prompt: string;
  resolvedPreset?: ResolvedConfiguredLocalAgentPreset;
  verifierCommands: CommandVerifierInput[];
}): Pick<
  CreateLocalAgentTaskOptions,
  | "prompt"
  | "preset"
  | "checkpoint"
  | "provider"
  | "model"
  | "baseUrl"
  | "mode"
  | "allowedPaths"
  | "deniedPaths"
  | "verifierCommands"
  | "maxTurns"
  | "maxToolCalls"
  | "maxFailedToolCalls"
> {
  const preset = input.resolvedPreset?.preset;

  return {
    prompt: input.resolvedPreset?.prompt ?? input.prompt,
    ...(preset === undefined
      ? {}
      : {
          preset: preset.id,
          checkpoint: preset.checkpoint
        }),
    ...agentTaskModelOptions(input.options, input.resolvedPreset?.model),
    mode: preset === undefined ? parseLocalAgentMode(input.options.mode) : preset.mode,
    allowedPaths: input.options.allowed,
    deniedPaths: input.options.denied,
    verifierCommands: input.verifierCommands,
    ...agentBudgetTaskOptions(
      input.options,
      preset === undefined
        ? {}
        : {
            maxTurns: preset.maxTurns,
            maxToolCalls: preset.maxToolCalls,
            maxFailedToolCalls: preset.maxFailedToolCalls
          }
    )
  };
}

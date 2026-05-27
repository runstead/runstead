import type { CreateLocalAgentTaskOptions } from "../local-agent-types.js";

export interface AgentTaskModelCliOptions {
  provider?: string;
  model?: string;
  baseUrl?: string;
}

export function agentTaskModelOptions(
  options: AgentTaskModelCliOptions,
  presetModel?: string
): Pick<CreateLocalAgentTaskOptions, "provider" | "model" | "baseUrl"> {
  const model = options.model ?? presetModel;

  return {
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(model === undefined ? {} : { model }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
  };
}

import { parseRequiredPositiveInteger } from "../cli-parsers.js";

import type { CreateLocalAgentTaskOptions } from "../local-agent.js";

export interface AgentBudgetCliOptions {
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
}

export type AgentBudgetTaskOptions = Pick<
  CreateLocalAgentTaskOptions,
  "maxTurns" | "maxToolCalls" | "maxFailedToolCalls"
>;

export interface AgentBudgetDefaults {
  maxTurns?: number;
  maxToolCalls?: number;
  maxFailedToolCalls?: number;
}

export interface AgentRunReportOptions {
  cwd?: string;
  taskId: string;
}

export function agentBudgetTaskOptions(
  options: AgentBudgetCliOptions,
  defaults: AgentBudgetDefaults = {}
): AgentBudgetTaskOptions {
  return {
    ...agentBudgetValue("maxTurns", options.maxTurns, defaults.maxTurns, "--max-turns"),
    ...agentBudgetValue(
      "maxToolCalls",
      options.maxToolCalls,
      defaults.maxToolCalls,
      "--max-tool-calls"
    ),
    ...agentBudgetValue(
      "maxFailedToolCalls",
      options.maxFailedToolCalls,
      defaults.maxFailedToolCalls,
      "--max-failed-tool-calls"
    )
  };
}

function agentBudgetValue<Key extends keyof AgentBudgetTaskOptions>(
  key: Key,
  value: string | undefined,
  defaultValue: number | undefined,
  flag: string
): Pick<AgentBudgetTaskOptions, Key> {
  if (value !== undefined) {
    return {
      [key]: parseRequiredPositiveInteger(value, flag)
    } as Pick<AgentBudgetTaskOptions, Key>;
  }

  if (defaultValue !== undefined) {
    return {
      [key]: defaultValue
    } as Pick<AgentBudgetTaskOptions, Key>;
  }

  return {} as Pick<AgentBudgetTaskOptions, Key>;
}

export async function runAndReportLocalAgentTask(
  options: AgentRunReportOptions
): Promise<void> {
  const { formatLocalAgentRunReport, localAgentRunExitCode, runLocalAgentTask } =
    await import("../local-agent.js");
  const result = await runLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: options.taskId
  });
  const exitCode = localAgentRunExitCode(result);

  console.log(formatLocalAgentRunReport(result));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

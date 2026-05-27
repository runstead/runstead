import { requireRbacPermission } from "../cli-rbac.js";

import { agentBudgetTaskOptions } from "./agent-budget-options.js";
import {
  parseLocalAgentMode,
  resolveAgentRunPresetOptions
} from "./agent-run-options.js";
import { runCreatedLocalAgentTask } from "./agent-task-execution.js";
import { agentTaskModelOptions } from "./agent-task-options.js";
import {
  ALL_LOCAL_AGENT_WORKERS,
  parseAgentWorkerOption
} from "./agent-worker-options.js";

export interface AgentRunCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  mode: string;
  preset?: string;
  allowed: string[];
  denied: string[];
  verifier: string[];
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

export async function runAgentRunCommand(
  promptParts: string[],
  options: AgentRunCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "run local agent tasks"
  });

  const worker = parseAgentWorkerOption({
    worker: options.worker,
    supported: ALL_LOCAL_AGENT_WORKERS,
    unsupportedMessage:
      "agent run currently supports --worker codex_direct, codex_cli, or claude_code"
  });

  const { createLocalAgentTask } = await import("../local-agent.js");
  const prompt = promptParts.join(" ").trim();
  const { resolvedPreset, verifierCommands, runPresetVerifiersFirst } =
    await resolveAgentRunPresetOptions({
      prompt,
      verifier: options.verifier,
      ...(options.preset === undefined ? {} : { preset: options.preset }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    });

  const created = await createLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    prompt: resolvedPreset?.prompt ?? prompt,
    ...(resolvedPreset === undefined
      ? {}
      : {
          preset: resolvedPreset.preset.id,
          checkpoint: resolvedPreset.preset.checkpoint
        }),
    worker,
    ...agentTaskModelOptions(options, resolvedPreset?.model),
    mode:
      resolvedPreset === undefined
        ? parseLocalAgentMode(options.mode)
        : resolvedPreset.preset.mode,
    allowedPaths: options.allowed,
    deniedPaths: options.denied,
    verifierCommands,
    ...agentBudgetTaskOptions(
      options,
      resolvedPreset === undefined
        ? {}
        : {
            maxTurns: resolvedPreset.preset.maxTurns,
            maxToolCalls: resolvedPreset.preset.maxToolCalls,
            maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
          }
    )
  });

  await runCreatedLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id,
    verifierFirst: runPresetVerifiersFirst
  });
}

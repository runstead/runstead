import { requireRbacPermission } from "../cli-rbac.js";

import { resolveAgentRunPresetOptions } from "./agent-run-options.js";
import { agentRunTaskOptions } from "./agent-run-task-options.js";
import { runCreatedLocalAgentTask } from "./agent-task-execution.js";
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
    ...agentRunTaskOptions({
      options,
      prompt,
      ...(resolvedPreset === undefined ? {} : { resolvedPreset }),
      verifierCommands
    }),
    worker
  });

  await runCreatedLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id,
    verifierFirst: runPresetVerifiersFirst
  });
}

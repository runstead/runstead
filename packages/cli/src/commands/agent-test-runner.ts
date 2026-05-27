import { requireRbacPermission } from "../cli-rbac.js";

import {
  agentBudgetTaskOptions,
  runAndReportLocalAgentTask
} from "./agent-budget-options.js";
import { resolveAgentPresetVerifierOptions } from "./agent-preset-verifiers.js";
import { agentTaskModelOptions } from "./agent-task-options.js";
import {
  CODEX_DIRECT_AGENT_WORKERS,
  parseAgentWorkerOption
} from "./agent-worker-options.js";

export interface AgentTestCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  verifier: string[];
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

export async function runAgentTestCommand(
  focusParts: string[],
  options: AgentTestCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "run local agent test triage"
  });

  const worker = parseAgentWorkerOption({
    worker: options.worker,
    supported: CODEX_DIRECT_AGENT_WORKERS,
    unsupportedMessage: "agent test currently supports --worker codex_direct only"
  });

  const { attachLocalAgentVerifierEvidence, createLocalAgentTask } =
    await import("../local-agent.js");
  const focus = focusParts.join(" ").trim();
  const { resolvedPreset, verifierCommands } = await resolveAgentPresetVerifierOptions({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    presetId: "test:triage",
    prompt: focus,
    verifier: options.verifier,
    commandName: "agent test",
    missingVerifierMessage:
      "agent test requires at least one --verifier name=command, --verifier auto, or preset verifier"
  });
  const created = await createLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    prompt: resolvedPreset.prompt,
    preset: resolvedPreset.preset.id,
    title: "Local agent test triage",
    worker,
    ...agentTaskModelOptions(options, resolvedPreset.model),
    mode: resolvedPreset.preset.mode,
    checkpoint: resolvedPreset.preset.checkpoint,
    verifierCommands,
    ...agentBudgetTaskOptions(options, {
      maxTurns: resolvedPreset.preset.maxTurns,
      maxToolCalls: resolvedPreset.preset.maxToolCalls,
      maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
    })
  });

  await attachLocalAgentVerifierEvidence({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });

  await runAndReportLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
}

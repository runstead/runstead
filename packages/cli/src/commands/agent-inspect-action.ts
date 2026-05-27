import { requireRbacPermission } from "../cli-rbac.js";

import { agentBudgetTaskOptions } from "./agent-budget-options.js";
import { localAgentInspectPresetId } from "./agent-inspect-depth.js";
import { runCreatedLocalAgentTask } from "./agent-task-execution.js";
import { agentTaskModelOptions } from "./agent-task-options.js";
import {
  CODEX_DIRECT_AGENT_WORKERS,
  parseAgentWorkerOption
} from "./agent-worker-options.js";

export interface AgentInspectCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  depth: string;
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

export async function runAgentInspectCommand(
  focusParts: string[],
  options: AgentInspectCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "run local agent inspection"
  });

  const worker = parseAgentWorkerOption({
    worker: options.worker,
    supported: CODEX_DIRECT_AGENT_WORKERS,
    unsupportedMessage: "agent inspect currently supports --worker codex_direct only"
  });

  const { createLocalAgentTask } = await import("../local-agent.js");
  const { resolveConfiguredLocalAgentPreset } =
    await import("../local-agent-presets.js");
  const focus = focusParts.join(" ").trim();
  const resolvedPreset = await resolveConfiguredLocalAgentPreset(
    localAgentInspectPresetId(options.depth),
    focus.length === 0 ? {} : { prompt: focus },
    {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    }
  );
  const created = await createLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    prompt: resolvedPreset.prompt,
    preset: resolvedPreset.preset.id,
    title: `Local agent ${resolvedPreset.preset.id}`,
    worker,
    ...agentTaskModelOptions(options, resolvedPreset.model),
    mode: resolvedPreset.preset.mode,
    checkpoint: resolvedPreset.preset.checkpoint,
    ...agentBudgetTaskOptions(options, {
      maxTurns: resolvedPreset.preset.maxTurns,
      maxToolCalls: resolvedPreset.preset.maxToolCalls,
      maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
    })
  });
  await runCreatedLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
}

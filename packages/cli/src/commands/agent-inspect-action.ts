import { requireRbacPermission } from "../cli-rbac.js";

import { localAgentInspectPresetId } from "./agent-inspect-depth.js";
import { agentPresetTaskOptions } from "./agent-preset-task-options.js";
import { runCreatedLocalAgentTask } from "./agent-task-execution.js";
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
    ...agentPresetTaskOptions(options, resolvedPreset),
    title: `Local agent ${resolvedPreset.preset.id}`,
    worker
  });
  await runCreatedLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
}

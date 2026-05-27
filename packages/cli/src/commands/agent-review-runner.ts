import { requireRbacPermission } from "../cli-rbac.js";

import {
  assertSingleReviewScope,
  localAgentReviewGitDiffBase,
  localAgentReviewPresetId,
  localAgentReviewScope
} from "./agent-review-scope.js";
import { localAgentReviewPrompt } from "./agent-review-prompt.js";
import { agentPresetTaskOptions } from "./agent-preset-task-options.js";
import { runCreatedLocalAgentTask } from "./agent-task-execution.js";
import {
  CODEX_DIRECT_AGENT_WORKERS,
  parseAgentWorkerOption
} from "./agent-worker-options.js";

export interface AgentReviewCliOptions {
  cwd?: string;
  worker: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  staged?: boolean;
  base?: string;
  unpushed?: boolean;
  maxTurns?: string;
  maxToolCalls?: string;
  maxFailedToolCalls?: string;
  actor: string;
}

export async function runAgentReviewCommand(
  focusParts: string[],
  options: AgentReviewCliOptions
): Promise<void> {
  await requireRbacPermission({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    actor: options.actor,
    permission: "task.run",
    action: "run local agent review"
  });

  const worker = parseAgentWorkerOption({
    worker: options.worker,
    supported: CODEX_DIRECT_AGENT_WORKERS,
    unsupportedMessage: "agent review currently supports --worker codex_direct only"
  });

  assertSingleReviewScope(options);

  const { createLocalAgentTask } = await import("../local-agent.js");
  const { resolveConfiguredLocalAgentPreset } =
    await import("../local-agent-presets.js");
  const focus = focusParts.join(" ").trim();
  const scope = localAgentReviewScope(options);
  const gitDiffBase = localAgentReviewGitDiffBase(scope);
  const resolvedPreset = await resolveConfiguredLocalAgentPreset(
    localAgentReviewPresetId(scope),
    { prompt: localAgentReviewPrompt({ scope, focus }) },
    {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    }
  );
  const created = await createLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...agentPresetTaskOptions(options, resolvedPreset),
    title: `Local agent review ${scope.title}`,
    worker,
    gitDiffStaged: options.staged === true,
    ...(gitDiffBase === undefined ? {} : { gitDiffBase })
  });
  await runCreatedLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
}

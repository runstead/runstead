import { requireRbacPermission } from "../cli-rbac.js";

import {
  agentBudgetTaskOptions,
  runAndReportLocalAgentTask
} from "./agent-budget-options.js";
import {
  assertSingleReviewScope,
  localAgentReviewGitDiffBase,
  localAgentReviewPresetId,
  localAgentReviewScope
} from "./agent-review-scope.js";
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
    {
      prompt: [
        scope.prompt,
        scope.gitDiffInstruction,
        ...(focus.length === 0 ? [] : [focus])
      ].join("\n")
    },
    {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    }
  );
  const model = options.model ?? resolvedPreset.model;
  const created = await createLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    prompt: resolvedPreset.prompt,
    preset: resolvedPreset.preset.id,
    title: `Local agent review ${scope.title}`,
    worker,
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(model === undefined ? {} : { model }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    mode: resolvedPreset.preset.mode,
    checkpoint: resolvedPreset.preset.checkpoint,
    gitDiffStaged: options.staged === true,
    ...(gitDiffBase === undefined ? {} : { gitDiffBase }),
    ...agentBudgetTaskOptions(options, {
      maxTurns: resolvedPreset.preset.maxTurns,
      maxToolCalls: resolvedPreset.preset.maxToolCalls,
      maxFailedToolCalls: resolvedPreset.preset.maxFailedToolCalls
    })
  });
  await runAndReportLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
}

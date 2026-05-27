import { parseCiRepairWorkerKind } from "../cli-parsers.js";
import { requireRbacPermission } from "../cli-rbac.js";

import { agentBudgetTaskOptions } from "./agent-budget-options.js";

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

type LocalAgentReviewScope =
  | {
      kind: "staged" | "unstaged" | "unpushed";
      title: string;
      prompt: string;
      gitDiffInstruction: string;
    }
  | {
      kind: "base";
      base: string;
      title: string;
      prompt: string;
      gitDiffInstruction: string;
    };

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

  const worker = parseCiRepairWorkerKind(options.worker);

  if (worker !== "codex_direct") {
    throw new Error("agent review currently supports --worker codex_direct only");
  }

  assertSingleReviewScope(options);

  const {
    createLocalAgentTask,
    formatLocalAgentRunReport,
    localAgentRunExitCode,
    runLocalAgentTask
  } = await import("../local-agent.js");
  const { resolveConfiguredLocalAgentPreset } =
    await import("../local-agent-presets.js");
  const focus = focusParts.join(" ").trim();
  const scope = localAgentReviewScope(options);
  const gitDiffBase =
    scope.kind === "base"
      ? scope.base
      : scope.kind === "unpushed"
        ? "@{upstream}"
        : undefined;
  const resolvedPreset = await resolveConfiguredLocalAgentPreset(
    scope.kind === "staged"
      ? "review:staged"
      : scope.kind === "unpushed"
        ? "review:unpushed"
        : "review:diff",
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
  const result = await runLocalAgentTask({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    taskId: created.task.id
  });
  const exitCode = localAgentRunExitCode(result);

  console.log(formatLocalAgentRunReport(result));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

function assertSingleReviewScope(options: AgentReviewCliOptions): void {
  const scopes = [
    options.staged === true,
    options.base !== undefined,
    options.unpushed === true
  ].filter(Boolean);

  if (scopes.length > 1) {
    throw new Error("agent review accepts only one of --staged, --base, or --unpushed");
  }
}

function localAgentReviewScope(options: AgentReviewCliOptions): LocalAgentReviewScope {
  if (options.staged === true) {
    return {
      kind: "staged",
      title: "staged diff",
      prompt: "Review the staged git diff only.",
      gitDiffInstruction: "When calling git_diff, pass staged=true."
    };
  }

  if (options.unpushed === true) {
    return {
      kind: "unpushed",
      title: "unpushed commits",
      prompt: "Review commits ahead of the upstream branch only.",
      gitDiffInstruction:
        "When calling git_diff, pass base='@{upstream}' and leave staged unset."
    };
  }

  if (options.base !== undefined) {
    return {
      kind: "base",
      base: options.base,
      title: `${options.base}...HEAD`,
      prompt: `Review the git diff from ${options.base} to HEAD only.`,
      gitDiffInstruction: `When calling git_diff, pass base='${options.base}' and leave staged unset.`
    };
  }

  return {
    kind: "unstaged",
    title: "unstaged diff",
    prompt: "Review the unstaged git diff only.",
    gitDiffInstruction: "When calling git_diff, leave staged unset or false."
  };
}

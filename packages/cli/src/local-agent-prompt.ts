import type { JsonObject, Task } from "@runstead/core";

import {
  localAgentTaskMode,
  localAgentTaskStringArray,
  type LocalAgentMode,
  type LocalAgentWorkerKind
} from "./local-agent-task-input.js";
import type { CreateLocalAgentTaskOptions } from "./local-agent-types.js";
import {
  formatTaskContextPackPrompt,
  type TaskContextPack
} from "./task-context-pack.js";
import type { RunTaskVerifierCommandResult } from "./verifier-runner.js";

export function localAgentTaskInput(input: {
  cwd: string;
  prompt: string;
  worker: LocalAgentWorkerKind;
  mode: LocalAgentMode;
  options: CreateLocalAgentTaskOptions;
}): Task["input"] {
  return {
    repositoryPath: input.cwd,
    prompt: input.prompt,
    worker: input.worker,
    mode: input.mode,
    ...(input.options.preset === undefined ? {} : { preset: input.options.preset }),
    ...(input.options.provider === undefined
      ? {}
      : { provider: input.options.provider }),
    ...(input.options.model === undefined ? {} : { model: input.options.model }),
    ...(input.options.baseUrl === undefined ? {} : { baseUrl: input.options.baseUrl }),
    ...(input.options.allowedPaths === undefined
      ? {}
      : { allowedPaths: input.options.allowedPaths }),
    ...(input.options.deniedPaths === undefined
      ? {}
      : { deniedPaths: input.options.deniedPaths }),
    ...(input.options.approvalRequired === undefined
      ? {}
      : { approvalRequired: input.options.approvalRequired }),
    ...(input.options.verifierCommands === undefined
      ? {}
      : { commands: input.options.verifierCommands }),
    ...(input.options.maxTurns === undefined
      ? {}
      : { maxTurns: input.options.maxTurns }),
    ...(input.options.maxToolCalls === undefined
      ? {}
      : { maxToolCalls: input.options.maxToolCalls }),
    ...(input.options.maxFailedToolCalls === undefined
      ? {}
      : { maxFailedToolCalls: input.options.maxFailedToolCalls }),
    ...(input.options.modelRequestTimeoutMs === undefined
      ? {}
      : { modelRequestTimeoutMs: input.options.modelRequestTimeoutMs }),
    ...(input.options.modelRequestHeartbeatMs === undefined
      ? {}
      : { modelRequestHeartbeatMs: input.options.modelRequestHeartbeatMs }),
    ...(input.options.finalizeOnBudget === undefined
      ? {}
      : { finalizeOnBudget: input.options.finalizeOnBudget }),
    ...(input.options.scaffoldProfile === undefined
      ? {}
      : {
          scaffoldProfile: {
            id: input.options.scaffoldProfile.id,
            title: input.options.scaffoldProfile.title,
            ...(input.options.scaffoldProfile.template === undefined
              ? {}
              : { template: input.options.scaffoldProfile.template }),
            ...(input.options.scaffoldProfile.appType === undefined
              ? {}
              : { appType: input.options.scaffoldProfile.appType }),
            appOwnedPaths: input.options.scaffoldProfile.appOwnedPaths
          }
        }),
    ...(input.options.gitDiffStaged === undefined
      ? {}
      : { gitDiffStaged: input.options.gitDiffStaged }),
    ...(input.options.gitDiffBase === undefined
      ? {}
      : { gitDiffBase: input.options.gitDiffBase }),
    ...(input.options.checkpoint === undefined
      ? {}
      : { checkpoint: input.options.checkpoint }),
    ...(input.options.commit === undefined ? {} : { commit: input.options.commit }),
    ...(input.options.learningReview === undefined
      ? {}
      : { learningReview: input.options.learningReview })
  };
}

export function buildLocalAgentPrompt(
  task: Task,
  options: { contextPack?: TaskContextPack | undefined } = {}
): string {
  const prompt = requiredTaskString(task, "prompt");
  const mode = localAgentTaskMode(task);

  return [
    prompt,
    "",
    ...formatTaskContextPackPrompt(options.contextPack),
    "Runstead local-agent mode:",
    `- mode: ${mode}`,
    ...localAgentModePromptRules(task),
    "- End with a concise summary of what you inspected and any risks or next steps."
  ].join("\n");
}

function localAgentModePromptRules(task: Task): string[] {
  const mode = localAgentTaskMode(task);
  const allowedPaths = localAgentTaskStringArray(task, "allowedPaths");
  const deniedPaths = localAgentTaskStringArray(task, "deniedPaths");
  const approvalRequired = localAgentApprovalRequired(task);
  const pathRules = [
    ...(allowedPaths.length === 0
      ? []
      : [`- Stay within allowed paths: ${allowedPaths.join(", ")}`]),
    ...(deniedPaths.length === 0
      ? []
      : [`- Do not change denied paths: ${deniedPaths.join(", ")}`]),
    ...(approvalRequired.length === 0
      ? []
      : [`- Request approval before: ${approvalRequired.join(", ")}`])
  ];

  if (mode === "read-only") {
    return [
      "- Read-only mode must not call write_file or run_command.",
      "- Use git_status, git_diff, and read_file when useful.",
      ...pathRules
    ];
  }

  return [
    "- Edit and repair modes should prefer apply_patch for scoped workspace changes; use write_file only for generated whole-file contents.",
    "- Runstead creates the pre-edit checkpoint and runs configured verifiers after your model turn.",
    "- Avoid run_command unless the prompt explicitly requests command execution.",
    ...pathRules
  ];
}

export function localAgentAllowedScope(task: Task): string[] {
  const allowedPaths = localAgentTaskStringArray(task, "allowedPaths");

  if (allowedPaths.length > 0) {
    return allowedPaths;
  }

  return localAgentTaskMode(task) === "read-only"
    ? ["read-only workspace inspection"]
    : ["repository working tree"];
}

export function localAgentDeniedActions(task: Task): string[] {
  const deniedPaths = localAgentTaskStringArray(task, "deniedPaths");
  const denied = [
    ...(localAgentTaskMode(task) === "read-only"
      ? ["modify files", "run mutating commands"]
      : []),
    ...deniedPaths.map((path) => `modify ${path}`)
  ];

  return denied.length === 0
    ? ["access secrets", "push or publish without approval"]
    : denied;
}

export function localAgentApprovalRequired(task: Task): string[] {
  const explicit = localAgentTaskStringArray(task, "approvalRequired");

  return explicit.length === 0 ? ["dependency changes", "external writes"] : explicit;
}

export function formatVerifierEvidencePrompt(
  results: RunTaskVerifierCommandResult[]
): string {
  return [
    "Runstead verifier evidence:",
    ...(results.length === 0
      ? ["- none"]
      : results.map(
          (result) =>
            `- ${result.verifier}: exit=${result.exitCode ?? "unknown"} timedOut=${String(result.timedOut)} evidence=${result.evidenceId}`
        )),
    "Use this verifier evidence as the primary test context. Do not rerun tests unless explicitly requested."
  ].join("\n");
}

export function verifierEvidenceInput(
  result: RunTaskVerifierCommandResult
): JsonObject {
  return {
    verifier: result.verifier,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    forceKilled: result.forceKilled,
    evidenceId: result.evidenceId,
    ...(result.policyDecisionId === undefined
      ? {}
      : { policyDecisionId: result.policyDecisionId }),
    ...(result.approvalId === undefined ? {} : { approvalId: result.approvalId })
  };
}

export function requiredTaskString(task: Task, field: string): string {
  const value = task.input[field];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Local agent task ${field} is required`);
  }

  return value.trim();
}

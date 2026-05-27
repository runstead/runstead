import type { WorkerRun } from "@runstead/core";

import { gitDiffCommand, taskGitDiffBase, taskGitDiffStaged } from "./git-actions.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import {
  optionalField,
  optionalPositiveInteger,
  optionalString,
  requiredString
} from "./tool-argument-values.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";

type GitToolOptions = CodexDirectWorkerOptions & {
  workerRun: WorkerRun;
  toolCall: CodexDirectToolCall;
  resumeContext?: CodexDirectPendingToolResumeContext;
};

export function gitDiffToolCommand(options: GitToolOptions): string {
  const path = optionalString(options.toolCall.arguments.path);
  const staged = requestedGitDiffStaged(options);
  const base = requestedGitDiffBase(options);

  return gitDiffCommand({ path, staged, base });
}

export function gitLogToolOptions(options: GitToolOptions) {
  return {
    ...options,
    ...optionalField("range", optionalString(options.toolCall.arguments.range)),
    ...optionalField("path", optionalString(options.toolCall.arguments.path)),
    ...optionalField(
      "maxCommits",
      optionalPositiveInteger(options.toolCall.arguments.maxCommits)
    )
  };
}

export function gitShowToolOptions(options: GitToolOptions) {
  return {
    ...options,
    ref: requiredString(options.toolCall.arguments.ref, "ref"),
    ...optionalField("path", optionalString(options.toolCall.arguments.path)),
    ...optionalField(
      "maxBytes",
      optionalPositiveInteger(options.toolCall.arguments.maxBytes)
    )
  };
}

export function gitDiffSummaryToolOptions(options: GitToolOptions) {
  return {
    ...options,
    staged: requestedGitDiffStaged(options),
    ...optionalField("path", optionalString(options.toolCall.arguments.path)),
    ...optionalField("base", requestedGitDiffBase(options)),
    ...optionalField(
      "maxFiles",
      optionalPositiveInteger(options.toolCall.arguments.maxFiles)
    )
  };
}

function requestedGitDiffStaged(options: GitToolOptions): boolean {
  const requestedStaged = options.toolCall.arguments.staged === true;

  return taskGitDiffStaged(options.task) ?? requestedStaged;
}

function requestedGitDiffBase(options: GitToolOptions): string | undefined {
  return (
    taskGitDiffBase(options.task) ?? optionalString(options.toolCall.arguments.base)
  );
}

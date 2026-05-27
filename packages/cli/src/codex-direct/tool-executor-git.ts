import type { WorkerRun } from "@runstead/core";

import {
  runGovernedDiffSummary,
  runGovernedGitLog,
  runGovernedGitRead,
  runGovernedGitShow
} from "./governed-tools.js";
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

export async function executeCodexDirectGitTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string | undefined> {
  switch (options.toolCall.name) {
    case "git_status":
      return JSON.stringify(await runGovernedGitRead(options, "git status --short"));
    case "git_diff": {
      const path = optionalString(options.toolCall.arguments.path);
      const requestedStaged = options.toolCall.arguments.staged === true;
      const staged = taskGitDiffStaged(options.task) ?? requestedStaged;
      const base =
        taskGitDiffBase(options.task) ??
        optionalString(options.toolCall.arguments.base);
      const command = gitDiffCommand({ path, staged, base });

      return JSON.stringify(await runGovernedGitRead(options, command));
    }
    case "git_log":
      return JSON.stringify(
        await runGovernedGitLog({
          ...options,
          ...optionalField("range", optionalString(options.toolCall.arguments.range)),
          ...optionalField("path", optionalString(options.toolCall.arguments.path)),
          ...optionalField(
            "maxCommits",
            optionalPositiveInteger(options.toolCall.arguments.maxCommits)
          )
        })
      );
    case "git_show":
      return JSON.stringify(
        await runGovernedGitShow({
          ...options,
          ref: requiredString(options.toolCall.arguments.ref, "ref"),
          ...optionalField("path", optionalString(options.toolCall.arguments.path)),
          ...optionalField(
            "maxBytes",
            optionalPositiveInteger(options.toolCall.arguments.maxBytes)
          )
        })
      );
    case "diff_summary": {
      const path = optionalString(options.toolCall.arguments.path);
      const requestedStaged = options.toolCall.arguments.staged === true;
      const staged = taskGitDiffStaged(options.task) ?? requestedStaged;
      const base =
        taskGitDiffBase(options.task) ??
        optionalString(options.toolCall.arguments.base);

      return JSON.stringify(
        await runGovernedDiffSummary({
          ...options,
          staged,
          ...optionalField("path", path),
          ...optionalField("base", base),
          ...optionalField(
            "maxFiles",
            optionalPositiveInteger(options.toolCall.arguments.maxFiles)
          )
        })
      );
    }
    default:
      return undefined;
  }
}

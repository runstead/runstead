import type { WorkerRun } from "@runstead/core";

import { writeGovernedWorkspaceFile } from "../filesystem-proxy.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";
import {
  optionalField,
  optionalPositiveInteger,
  optionalReplacementArray,
  optionalString,
  optionalTimeoutMs,
  requiredString
} from "./tool-arguments.js";
import {
  runGovernedApplyPatch,
  runGovernedDiffSummary,
  runGovernedGitLog,
  runGovernedGitRead,
  runGovernedGitShow,
  runGovernedReadEvidence,
  runGovernedShellCommand,
  runGovernedVerifier,
  runGovernedWorkspaceFacts
} from "./governed-tools.js";
import { gitDiffCommand, taskGitDiffBase, taskGitDiffStaged } from "./git-actions.js";
import { governedToolOptions } from "./policy-actions.js";
import { executeCodexDirectWorkspaceReadTool } from "./tool-executor-workspace-read.js";

export async function executeCodexDirectTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string> {
  const workspaceReadResult = await executeCodexDirectWorkspaceReadTool(options);

  if (workspaceReadResult !== undefined) {
    return workspaceReadResult;
  }

  switch (options.toolCall.name) {
    case "apply_patch":
      return JSON.stringify(
        await runGovernedApplyPatch({
          ...options,
          ...optionalField("patch", optionalString(options.toolCall.arguments.patch)),
          ...optionalField(
            "replacements",
            optionalReplacementArray(options.toolCall.arguments.replacements)
          )
        })
      );
    case "run_verifier":
      return JSON.stringify(
        await runGovernedVerifier({
          ...options,
          name: requiredString(options.toolCall.arguments.name, "name"),
          ...optionalTimeoutMs(options.toolCall.arguments.timeoutMs)
        })
      );
    case "write_file":
      return JSON.stringify(
        await writeGovernedWorkspaceFile({
          ...governedToolOptions(options),
          path: requiredString(options.toolCall.arguments.path, "path"),
          content: requiredString(options.toolCall.arguments.content, "content"),
          createDirs: options.toolCall.arguments.createDirs === true
        }).then((result) => result.value)
      );
    case "run_command":
      return JSON.stringify(
        await runGovernedShellCommand({
          ...options,
          command: requiredString(options.toolCall.arguments.command, "command"),
          ...optionalTimeoutMs(options.toolCall.arguments.timeoutMs)
        })
      );
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
    case "read_evidence":
      return JSON.stringify(
        await runGovernedReadEvidence({
          ...options,
          id: requiredString(options.toolCall.arguments.id, "id"),
          ...optionalField(
            "maxBytes",
            optionalPositiveInteger(options.toolCall.arguments.maxBytes)
          )
        })
      );
    case "workspace_facts":
      return JSON.stringify(
        await runGovernedWorkspaceFacts({
          ...options,
          refresh: options.toolCall.arguments.refresh === true
        })
      );
  }

  throw new Error(`Unsupported Codex Direct tool: ${options.toolCall.name}`);
}

import type { WorkerRun } from "@runstead/core";

import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "../governed-action.js";
import {
  readGovernedWorkspaceFile,
  writeGovernedWorkspaceFile
} from "../filesystem-proxy.js";
import type { CodexDirectWorkerOptions } from "./worker.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import {
  optionalField,
  optionalNonNegativeInteger,
  optionalPositiveInteger,
  optionalReplacementArray,
  optionalString,
  optionalStringArray,
  optionalTimeoutMs,
  requiredString,
  requiredStringArray,
  toolExecutionErrorOutput
} from "./tool-arguments.js";
import {
  runGovernedApplyPatch,
  runGovernedDiffSummary,
  runGovernedFileInfo,
  runGovernedGitLog,
  runGovernedGitRead,
  runGovernedGitShow,
  runGovernedListFiles,
  runGovernedPackageScripts,
  runGovernedReadEvidence,
  runGovernedReadManyFiles,
  runGovernedSearchText,
  runGovernedShellCommand,
  runGovernedTree,
  runGovernedVerifier,
  runGovernedWorkspaceFacts
} from "./governed-tools.js";
import { governedToolOptions } from "./policy-actions.js";
import { gitDiffCommand } from "./git-actions.js";
import { taskGitDiffBase, taskGitDiffStaged } from "./git-actions.js";

export {
  buildCodexDirectInstructions,
  codexDirectToolDefinitions
} from "./tool-definitions.js";
export { buildCodexDirectUserPrompt } from "./prompts.js";
export {
  codexDirectVerificationStatus,
  codexDirectWarningOptions,
  completedWorkerResult,
  finalizeBudgetExceededWorkerResult,
  recordCodexDirectVerifierResult
} from "./result.js";
export { governedToolOptions, modelInferenceAction } from "./policy-actions.js";
export { parseCodexDirectToolCall } from "./tool-arguments.js";
export {
  parsePendingPatchAction,
  type CodexDirectPendingPatchPayload
} from "./patch-actions.js";
export {
  CodexDirectModelRetryExhaustedError,
  CodexDirectModelTimeoutError,
  modelRetryExhaustedInterruption,
  modelTimeoutInterruption,
  runGovernedModelInference
} from "./model-request.js";

export async function runCodexDirectTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<{ output: string; failed: boolean }> {
  try {
    return {
      output: await executeCodexDirectTool(options),
      failed: false
    };
  } catch (error) {
    if (
      error instanceof ToolActionApprovalRequiredError ||
      error instanceof ToolActionDeniedError
    ) {
      throw error;
    }

    return {
      output: JSON.stringify(toolExecutionErrorOutput(error)),
      failed: true
    };
  }
}

async function executeCodexDirectTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string> {
  switch (options.toolCall.name) {
    case "list_files":
      return JSON.stringify(
        await runGovernedListFiles({
          ...options,
          ...optionalField(
            "glob",
            optionalStringArray(options.toolCall.arguments.glob, "glob")
          ),
          ...optionalField(
            "exclude",
            optionalStringArray(options.toolCall.arguments.exclude, "exclude")
          ),
          ...optionalField(
            "maxResults",
            optionalPositiveInteger(options.toolCall.arguments.maxResults)
          ),
          includeDirs: options.toolCall.arguments.includeDirs === true
        })
      );
    case "search_text":
      return JSON.stringify(
        await runGovernedSearchText({
          ...options,
          query: requiredString(options.toolCall.arguments.query, "query"),
          regex: options.toolCall.arguments.regex === true,
          ...optionalField(
            "glob",
            optionalStringArray(options.toolCall.arguments.glob, "glob")
          ),
          caseSensitive: options.toolCall.arguments.caseSensitive === true,
          ...optionalField(
            "contextLines",
            optionalNonNegativeInteger(
              options.toolCall.arguments.contextLines,
              "contextLines"
            )
          ),
          ...optionalField(
            "maxMatches",
            optionalPositiveInteger(options.toolCall.arguments.maxMatches)
          ),
          ...optionalField(
            "maxBytesPerFile",
            optionalPositiveInteger(options.toolCall.arguments.maxBytesPerFile)
          )
        })
      );
    case "read_file":
      return JSON.stringify(
        await readGovernedWorkspaceFile({
          ...governedToolOptions(options),
          path: requiredString(options.toolCall.arguments.path, "path")
        }).then((result) => result.value)
      );
    case "read_many_files":
      return JSON.stringify(
        await runGovernedReadManyFiles({
          ...options,
          paths: requiredStringArray(options.toolCall.arguments.paths, "paths"),
          ...optionalField(
            "maxBytesPerFile",
            optionalPositiveInteger(options.toolCall.arguments.maxBytesPerFile)
          ),
          ...optionalField(
            "maxTotalBytes",
            optionalPositiveInteger(options.toolCall.arguments.maxTotalBytes)
          )
        })
      );
    case "file_info":
      return JSON.stringify(
        await runGovernedFileInfo({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? ".",
          ...optionalField(
            "maxEntries",
            optionalPositiveInteger(options.toolCall.arguments.maxEntries)
          )
        })
      );
    case "tree":
      return JSON.stringify(
        await runGovernedTree({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? ".",
          ...optionalField(
            "maxDepth",
            optionalPositiveInteger(options.toolCall.arguments.maxDepth)
          ),
          ...optionalField(
            "maxEntries",
            optionalPositiveInteger(options.toolCall.arguments.maxEntries)
          ),
          includeFiles: options.toolCall.arguments.includeFiles !== false
        })
      );
    case "package_scripts":
      return JSON.stringify(
        await runGovernedPackageScripts({
          ...options,
          path: optionalString(options.toolCall.arguments.path) ?? "."
        })
      );
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
}

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
  runGovernedReadEvidence,
  runGovernedShellCommand,
  runGovernedVerifier,
  runGovernedWorkspaceFacts
} from "./governed-tools.js";
import { governedToolOptions } from "./policy-actions.js";
import { executeCodexDirectGitTool } from "./tool-executor-git.js";
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

  const gitResult = await executeCodexDirectGitTool(options);

  if (gitResult !== undefined) {
    return gitResult;
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

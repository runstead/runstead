import type { WorkerRun } from "@runstead/core";

import { writeGovernedWorkspaceFile } from "../filesystem-proxy.js";
import {
  runGovernedApplyPatch,
  runGovernedShellCommand,
  runGovernedVerifier
} from "./governed-tools.js";
import { governedToolOptions } from "./policy-actions.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import {
  optionalField,
  optionalReplacementArray,
  optionalString,
  optionalTimeoutMs,
  requiredString
} from "./tool-argument-values.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";

export async function executeCodexDirectMutationTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string | undefined> {
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
    default:
      return undefined;
  }
}

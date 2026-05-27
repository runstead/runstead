import type { WorkerRun } from "@runstead/core";

import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";
import { executeCodexDirectEvidenceTool } from "./tool-executor-evidence.js";
import { executeCodexDirectGitTool } from "./tool-executor-git.js";
import { executeCodexDirectMutationTool } from "./tool-executor-mutation.js";
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

  const evidenceResult = await executeCodexDirectEvidenceTool(options);

  if (evidenceResult !== undefined) {
    return evidenceResult;
  }

  const mutationResult = await executeCodexDirectMutationTool(options);

  if (mutationResult !== undefined) {
    return mutationResult;
  }

  throw new Error(`Unsupported Codex Direct tool: ${options.toolCall.name}`);
}

import type { WorkerRun } from "@runstead/core";

import {
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "../governed-action.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";
import { toolExecutionErrorOutput } from "./tool-arguments.js";
import { executeCodexDirectTool } from "./tool-executor.js";

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

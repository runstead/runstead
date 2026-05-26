import {
  type CodexResponsesInputItem,
  CodexResponsesTransport
} from "../codex-responses-transport.js";
import { startWorkerRun } from "../runtime-audit.js";

import { runCodexDirectConversation } from "./conversation.js";
import {
  CODEX_DIRECT_WORKER_KIND,
  DEFAULT_CODEX_DIRECT_MAX_TURNS
} from "./constants.js";
import { buildCodexDirectUserPrompt } from "./tool-router.js";
import type {
  CodexDirectTransport,
  CodexDirectWorkerOptions,
  CodexDirectWorkerResult
} from "./worker-types.js";

export {
  CODEX_DIRECT_WORKER_KIND,
  DEFAULT_CODEX_DIRECT_FINAL_SUMMARY_REQUEST_TIMEOUT_MS,
  DEFAULT_CODEX_DIRECT_MAX_TURNS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_HEARTBEAT_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_MAX_RETRIES,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_BASE_DELAY_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_JITTER_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_RETRY_MAX_DELAY_MS,
  DEFAULT_CODEX_DIRECT_MODEL_REQUEST_TIMEOUT_MS
} from "./constants.js";
export {
  buildCodexDirectInstructions,
  codexDirectToolDefinitions
} from "./tool-router.js";
export {
  readApprovedCodexDirectPendingPatch,
  runCodexDirectPendingPatchResume
} from "./pending-patch-resume.js";
export type {
  CodexDirectBudgetReason,
  CodexDirectBudgetSummary,
  CodexDirectInterruptionSummary,
  CodexDirectModelRequestPhase,
  CodexDirectModelRetryExhaustedInterruptionSummary,
  CodexDirectModelTimeoutInterruptionSummary,
  CodexDirectPendingPatchResume,
  CodexDirectPendingPatchResumeOptions,
  CodexDirectTransport,
  CodexDirectWorkerOptions,
  CodexDirectWorkerResult
} from "./worker-types.js";

export function createCodexDirectTransport(options: {
  baseUrl: string;
  accessToken: string;
  fetch?: ConstructorParameters<typeof CodexResponsesTransport>[0]["fetch"];
}): CodexDirectTransport {
  return new CodexResponsesTransport({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
}

export async function runCodexDirectWorker(
  options: CodexDirectWorkerOptions
): Promise<CodexDirectWorkerResult> {
  const workerRun = startWorkerRun({
    database: options.database,
    task: options.task,
    workerType: CODEX_DIRECT_WORKER_KIND,
    enforcementLevel: "hard_proxy_tool_calls",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  const messages: CodexResponsesInputItem[] = [
    {
      role: "user",
      content: options.prompt ?? buildCodexDirectUserPrompt(options)
    }
  ];
  const executedToolCalls = 0;
  const failedToolCalls = 0;
  const maxTurns = options.maxTurns ?? DEFAULT_CODEX_DIRECT_MAX_TURNS;

  return runCodexDirectConversation({
    options,
    workerRun,
    messages,
    maxTurns,
    executedToolCalls,
    failedToolCalls
  });
}

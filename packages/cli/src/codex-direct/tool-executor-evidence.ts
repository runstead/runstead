import type { WorkerRun } from "@runstead/core";

import {
  runGovernedReadEvidence,
  runGovernedWorkspaceFacts
} from "./governed-tools.js";
import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import {
  optionalField,
  optionalPositiveInteger,
  requiredString
} from "./tool-arguments.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";

export async function executeCodexDirectEvidenceTool(
  options: CodexDirectWorkerOptions & {
    workerRun: WorkerRun;
    toolCall: CodexDirectToolCall;
    resumeContext?: CodexDirectPendingToolResumeContext;
  }
): Promise<string | undefined> {
  switch (options.toolCall.name) {
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
    default:
      return undefined;
  }
}

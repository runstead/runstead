import type { WorkerRun } from "@runstead/core";

import type { CodexDirectPendingToolResumeContext } from "./patch-actions.js";
import type { CodexDirectToolCall } from "./tool-types.js";
import type { CodexDirectWorkerOptions } from "./worker-types.js";

export type WorkspaceReadToolOptions = CodexDirectWorkerOptions & {
  workerRun: WorkerRun;
  toolCall: CodexDirectToolCall;
  resumeContext?: CodexDirectPendingToolResumeContext;
};

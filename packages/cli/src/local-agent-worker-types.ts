import type { JsonObject } from "@runstead/core";

import type { CodexDirectWorkerResult } from "./codex-direct-worker.js";
import type { WrappedWorkerRunResult } from "./wrapped-worker.js";

export type LocalAgentWorkerResult = CodexDirectWorkerResult | WrappedWorkerRunResult;

export interface LocalAgentWorkerGovernanceProfile {
  level: "level_1_wrapper" | "level_2_native_proxy";
  enforcement?: string;
  boundary: "process_wrapper" | "native_tool_proxy";
  hardProxyToolCalls: boolean;
  internalToolProxy: "none" | "runstead_governed_actions";
  policyEnforcement: "launch_gate" | "per_tool_call";
  workspaceCheckpoint?: boolean;
  postRunDiffVerification?: boolean;
  auditedActions: string[];
  limitations: string[];
}

export type LocalAgentWorkerGovernanceOutput = JsonObject;

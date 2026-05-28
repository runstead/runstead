import type { Task } from "@runstead/core";
import type { RuntimeVerificationStatus } from "@runstead/runtime";

import type { CodexDirectToolCall } from "./tool-types.js";
import {
  codexDirectVerificationStatus,
  recordCodexDirectVerifierResult
} from "./verifier-result.js";

export interface CodexDirectConversationVerifierTracker {
  verification: () => RuntimeVerificationStatus;
  record: (input: {
    toolCall: CodexDirectToolCall;
    toolResult: { output: string; failed: boolean };
  }) => void;
}

export function createCodexDirectConversationVerifierTracker(
  task: Task
): CodexDirectConversationVerifierTracker {
  const verifierResults = new Map<string, RuntimeVerificationStatus>();

  return {
    verification: () => codexDirectVerificationStatus(task, verifierResults),
    record: (input) =>
      recordCodexDirectVerifierResult({
        ...input,
        verifierResults
      })
  };
}

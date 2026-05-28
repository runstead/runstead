import {
  runtimeExecutionSemantics,
  type RuntimeExecutionSemantics,
  type RuntimeVerificationStatus,
  type RuntimeWorkerOutcome
} from "@runstead/runtime";

import type {
  CodexDirectBudgetSummary,
  CodexDirectWorkerResult
} from "./worker-types.js";

export function codexDirectExecutionSemantics(input: {
  status: CodexDirectWorkerResult["status"];
  toolCalls: number;
  budget?: CodexDirectBudgetSummary;
  verification: RuntimeVerificationStatus;
}): RuntimeExecutionSemantics {
  const worker: RuntimeWorkerOutcome = {
    kind: "governed",
    status: input.status,
    toolCalls: input.toolCalls,
    ...(input.budget === undefined ? {} : { budgetExhausted: true })
  };
  const verifier =
    input.verification === "skipped" ? undefined : { status: input.verification };

  return verifier === undefined
    ? runtimeExecutionSemantics({ worker })
    : runtimeExecutionSemantics({ worker, verifier });
}

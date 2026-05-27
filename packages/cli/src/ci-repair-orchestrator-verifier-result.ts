import type { Task } from "@runstead/core";

import type { RunTaskVerifiersResult } from "./verifier-runner.js";

export function normalizeCiRepairVerifierResult(input: {
  verifierResult: RunTaskVerifiersResult;
  ciRepairTask: Task;
}): RunTaskVerifiersResult {
  return {
    ...input.verifierResult,
    task: {
      ...input.verifierResult.task,
      goalId: input.ciRepairTask.goalId,
      input: input.ciRepairTask.input,
      verifiers: input.ciRepairTask.verifiers,
      createdAt: input.ciRepairTask.createdAt
    }
  };
}

import type { Task } from "@runstead/core";

import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { stageAtLeast } from "./ci-repair-orchestrator-context.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import { failCiRepairVerifier } from "./ci-repair-orchestrator-verification-failures.js";
import type { VerifyCiRepairWorkerChangesInput } from "./ci-repair-orchestrator-verification.js";
import { normalizeCiRepairVerifierResult } from "./ci-repair-orchestrator-verifier-result.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifiersResult
} from "./verifier-runner.js";

export interface ResolveCiRepairVerifierStageInput {
  run: VerifyCiRepairWorkerChangesInput;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  diffScope: GitDiffScopeVerification;
}

export interface ResolveCiRepairVerifierStageResult {
  task: Task;
  context: CiRepairOrchestratorStageContext;
  verifierResult: RunTaskVerifiersResult;
}

export async function resolveCiRepairVerifierStage(
  input: ResolveCiRepairVerifierStageInput
): Promise<ResolveCiRepairVerifierStageResult> {
  let task = input.task;
  let context = input.context;
  const verifierResult =
    stageAtLeast(context.stage, "verified") &&
    context.verifierTask !== undefined &&
    context.verifierCommandResults !== undefined
      ? {
          task: context.verifierTask,
          commandResults: context.verifierCommandResults
        }
      : await (input.run.verifierRunner ?? runTaskVerifiersUnlocked)({
          cwd: input.run.cwd,
          taskId: task.id,
          claim: false,
          mode: "evidence_only",
          ...(input.run.now === undefined ? {} : { now: input.run.now })
        });
  const normalizedVerifierResult = normalizeCiRepairVerifierResult({
    verifierResult,
    ciRepairTask: input.run.ciRepair.task
  });

  if (normalizedVerifierResult.task.status !== "completed") {
    await failCiRepairVerifier({
      run: input.run,
      task,
      context,
      verifierResult: normalizedVerifierResult
    });
  }

  if (!stageAtLeast(context.stage, "verified")) {
    ({ task, context } = writeCiRepairStage({
      database: input.run.database,
      task,
      context,
      stage: "verified",
      patch: {
        diffScope: input.diffScope,
        verifierTask: normalizedVerifierResult.task,
        verifierCommandResults: normalizedVerifierResult.commandResults
      },
      ...(input.run.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: input.run.onStagePersisted }),
      ...(input.run.now === undefined ? {} : { now: input.run.now })
    }));
  }

  return {
    task,
    context,
    verifierResult: normalizedVerifierResult
  };
}

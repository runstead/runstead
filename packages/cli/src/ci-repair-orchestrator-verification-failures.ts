import type { Task } from "@runstead/core";

import type { CiRepairOrchestratorStageContext } from "./ci-repair-orchestrator-context.js";
import { diffScopeOutput } from "./ci-repair-orchestrator-output.js";
import { markTaskTerminal } from "./ci-repair-orchestrator-task-state.js";
import { rollbackWorkerChanges } from "./ci-repair-orchestrator-worker-run.js";
import type { VerifyCiRepairWorkerChangesInput } from "./ci-repair-orchestrator-verification.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import { finishWorkerRun } from "./runtime-audit.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

export async function failCiRepairNoDiff(input: {
  run: VerifyCiRepairWorkerChangesInput;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  diffScope: GitDiffScopeVerification;
}): Promise<never> {
  await rollbackWorkerChanges({
    cwd: input.run.cwd,
    root: input.run.root,
    stateDb: input.run.stateDb,
    database: input.run.database,
    policy: input.run.policy,
    task: input.task,
    workerRun: input.run.workerRun,
    workerResult: input.run.workerResult,
    ...(input.run.gitRunner === undefined ? {} : { gitRunner: input.run.gitRunner }),
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  markTaskTerminal({
    database: input.run.database,
    task: input.task,
    status: "failed",
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: {
        ...input.context,
        stage: "failed"
      },
      summary: "CI repair produced no git diff"
    },
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  finishWorkerRun({
    database: input.run.database,
    workerRun: input.run.workerRun,
    status: "failed",
    output: diffScopeOutput(input.diffScope),
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  throw new Error("CI repair produced no git diff");
}

export async function failCiRepairDiffScope(input: {
  run: VerifyCiRepairWorkerChangesInput;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  diffScope: GitDiffScopeVerification;
}): Promise<never> {
  await rollbackWorkerChanges({
    cwd: input.run.cwd,
    root: input.run.root,
    stateDb: input.run.stateDb,
    database: input.run.database,
    policy: input.run.policy,
    task: input.task,
    workerRun: input.run.workerRun,
    workerResult: input.run.workerResult,
    ...(input.run.gitRunner === undefined ? {} : { gitRunner: input.run.gitRunner }),
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  markTaskTerminal({
    database: input.run.database,
    task: input.task,
    status: "failed",
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: {
        ...input.context,
        stage: "failed"
      },
      summary: "CI repair diff scope failed",
      violations: input.diffScope.violations
    },
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  finishWorkerRun({
    database: input.run.database,
    workerRun: input.run.workerRun,
    status: "failed",
    output: diffScopeOutput(input.diffScope),
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  throw new Error(
    `CI repair diff scope failed with ${input.diffScope.violations.length} violation(s)`
  );
}

export async function failCiRepairVerifier(input: {
  run: VerifyCiRepairWorkerChangesInput;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  verifierResult: RunTaskVerifiersResult;
}): Promise<never> {
  await rollbackWorkerChanges({
    cwd: input.run.cwd,
    root: input.run.root,
    stateDb: input.run.stateDb,
    database: input.run.database,
    policy: input.run.policy,
    task: input.verifierResult.task,
    workerRun: input.run.workerRun,
    workerResult: input.run.workerResult,
    ...(input.run.gitRunner === undefined ? {} : { gitRunner: input.run.gitRunner }),
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  markTaskTerminal({
    database: input.run.database,
    task: input.task,
    status: "failed",
    output: {
      ...(input.task.output ?? {}),
      summary: "CI repair verifier failed",
      verifierTaskStatus: input.verifierResult.task.status,
      ciRepairOrchestrator: {
        ...input.context,
        stage: "failed"
      }
    },
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  finishWorkerRun({
    database: input.run.database,
    workerRun: input.run.workerRun,
    status: "failed",
    output: {
      verifierTaskStatus: input.verifierResult.task.status
    },
    ...(input.run.now === undefined ? {} : { now: input.run.now })
  });
  throw new Error(
    `CI repair verifier ended with task status ${input.verifierResult.task.status}`
  );
}

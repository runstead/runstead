import type { Task, WorkerRun } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { PolicyProfile } from "./policy.js";
import {
  incrementCiRepairCounter,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context.js";
import { markTaskTerminal } from "./ci-repair-orchestrator-task-state.js";
import type {
  CiRepairGitRunner,
  CiRepairWorkerResult,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import {
  isCodexDirectWorkerResult,
  workerFailureText,
  workerOutput
} from "./ci-repair-orchestrator-worker-output.js";
import { rollbackWorkerChanges } from "./ci-repair-orchestrator-worker-run.js";
import { finishWorkerRun } from "./runtime-audit.js";

export async function handleCiRepairWorkerTerminalOutcome(input: {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  task: Task;
  workerRun: WorkerRun;
  workerResult: CiRepairWorkerResult;
  stageContext: CiRepairOrchestratorStageContext;
  ciRepair: RunCiRepairOrchestratorResult["ciRepair"];
  branchName: string;
  gitRunner?: CiRepairGitRunner;
  now?: Date;
}): Promise<RunCiRepairOrchestratorResult | undefined> {
  if (
    isCodexDirectWorkerResult(input.workerResult) &&
    input.workerResult.status === "waiting_approval"
  ) {
    const waitingContext = {
      ...input.stageContext,
      counters: incrementCiRepairCounter(input.stageContext, "approvalRound")
    };
    const waitingTask = markTaskTerminal({
      database: input.database,
      task: input.task,
      status: "waiting_approval",
      output: {
        ...(input.task.output ?? {}),
        summary: "Codex Direct worker requires approval",
        ciRepairOrchestrator: {
          ...waitingContext,
          approvalId: input.workerResult.approval?.id
        },
        ...(input.workerResult.approval === undefined
          ? {}
          : {
              approval: {
                id: input.workerResult.approval.id,
                status: "pending",
                actionId: input.workerResult.approval.actionId,
                policyDecisionId: input.workerResult.approval.policyDecisionId,
                reason: input.workerResult.approval.reason
              }
            })
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    finishWorkerRun({
      database: input.database,
      workerRun: input.workerRun,
      status: "waiting_approval",
      output: workerOutput(input.workerResult),
      ...(input.now === undefined ? {} : { now: input.now })
    });

    return {
      status: "waiting_approval",
      ciRepair: {
        ...input.ciRepair,
        task: waitingTask
      },
      branchName: input.branchName,
      workerResult: input.workerResult,
      ...(input.workerResult.approval === undefined
        ? {}
        : { approval: input.workerResult.approval })
    };
  }

  if (
    isCodexDirectWorkerResult(input.workerResult) &&
    input.workerResult.status === "blocked"
  ) {
    await rollbackWorkerChanges({
      cwd: input.cwd,
      root: input.root,
      stateDb: input.stateDb,
      database: input.database,
      policy: input.policy,
      task: input.task,
      workerRun: input.workerRun,
      workerResult: input.workerResult,
      ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    markTaskTerminal({
      database: input.database,
      task: input.task,
      status: "blocked",
      output: {
        ...(input.task.output ?? {}),
        summary: input.workerResult.summary,
        ciRepairOrchestrator: {
          ...input.stageContext,
          stage: "blocked"
        }
      },
      ...(input.now === undefined ? {} : { now: input.now })
    });
    finishWorkerRun({
      database: input.database,
      workerRun: input.workerRun,
      status: "blocked",
      output: workerOutput(input.workerResult),
      ...(input.now === undefined ? {} : { now: input.now })
    });
    throw new Error(input.workerResult.summary);
  }

  if (input.workerResult.exitCode === 0) {
    return undefined;
  }

  await rollbackWorkerChanges({
    cwd: input.cwd,
    root: input.root,
    stateDb: input.stateDb,
    database: input.database,
    policy: input.policy,
    task: input.task,
    workerRun: input.workerRun,
    workerResult: input.workerResult,
    ...(input.gitRunner === undefined ? {} : { gitRunner: input.gitRunner }),
    ...(input.now === undefined ? {} : { now: input.now })
  });
  markTaskTerminal({
    database: input.database,
    task: input.task,
    status: "failed",
    output: {
      ...(input.task.output ?? {}),
      summary: "CI repair worker failed",
      ciRepairOrchestrator: {
        ...input.stageContext,
        stage: "failed"
      },
      exitCode: input.workerResult.exitCode,
      stderrBytes: Buffer.byteLength(workerFailureText(input.workerResult), "utf8"),
      stderrOmitted: workerFailureText(input.workerResult).length > 0
    },
    ...(input.now === undefined ? {} : { now: input.now })
  });
  finishWorkerRun({
    database: input.database,
    workerRun: input.workerRun,
    status: "failed",
    output: workerOutput(input.workerResult),
    ...(input.now === undefined ? {} : { now: input.now })
  });
  throw new Error(
    `CI repair worker exited ${input.workerResult.exitCode}: ${workerFailureText(input.workerResult)}`
  );
}

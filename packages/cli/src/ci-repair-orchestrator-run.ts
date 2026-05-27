import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { showGoal } from "./goals.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadRootSync } from "./runstead-root.js";
import { startWorkerRun } from "./runtime-audit.js";
import { claimCiRepairOrchestratorTask } from "./ci-repair-orchestrator-claim.js";
import { handleCiRepairOrchestratorError } from "./ci-repair-orchestrator-error-handling.js";
import { prepareCiRepairOrchestratorIntake } from "./ci-repair-orchestrator-intake.js";
import { executeCiRepairPublishStage } from "./ci-repair-orchestrator-publish-stage.js";
import {
  assertNoRunningCiRepairOrchestratorWorker,
  findPullRequestResumeTask,
  resumeCiRepairPullRequest
} from "./ci-repair-orchestrator-resume.js";
import type {
  CiRepairWorkerResult,
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import { executeCiRepairWorkerStage } from "./ci-repair-orchestrator-worker-stage.js";
import { handleCiRepairWorkerTerminalOutcome } from "./ci-repair-orchestrator-worker-terminal.js";
import { prepareCiRepairWorkspace } from "./ci-repair-orchestrator-workspace.js";

export async function runCiRepairOrchestrator(
  options: RunCiRepairOrchestratorOptions
): Promise<RunCiRepairOrchestratorResult> {
  const cwd = resolve(options.cwd ?? process.cwd());

  return withRunsteadManagerLock({ cwd }, () =>
    runCiRepairOrchestratorUnlocked({
      ...options,
      cwd
    })
  );
}

export async function runCiRepairOrchestratorUnlocked(
  options: RunCiRepairOrchestratorOptions
): Promise<RunCiRepairOrchestratorResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const root = requireRunsteadRootSync(cwd).root;
  const resumedTask = findPullRequestResumeTask({ cwd, runId: options.runId });

  if (resumedTask !== undefined) {
    return resumeCiRepairPullRequest({
      cwd,
      root,
      task: resumedTask,
      ...(options.githubRunner === undefined
        ? {}
        : { githubRunner: options.githubRunner }),
      ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
      ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
      ...(options.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: options.onStagePersisted }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  }

  const stateDb = join(root, "state.db");
  const policy = await loadPolicyProfileFromFile(
    join(root, "policies", "repo-maintenance.yaml")
  );
  const intake = await prepareCiRepairOrchestratorIntake({ cwd, options });

  if (intake.status === "ignored") {
    return intake.result;
  }

  let ciRepair = intake.ciRepair;
  const goal = showGoal({ cwd, id: ciRepair.task.goalId }).goal;
  const { base, branchName } = intake;
  const database = openRunsteadDatabase(stateDb);
  let orchestratorTask = ciRepair.task;
  const restoredStageContext = intake.restoredStageContext;
  let stageContext = intake.stageContext;

  try {
    ({ task: orchestratorTask, context: stageContext } = claimCiRepairOrchestratorTask({
      database,
      task: orchestratorTask,
      context: stageContext,
      restored: restoredStageContext !== undefined,
      ...(options.onStagePersisted === undefined
        ? {}
        : { onStagePersisted: options.onStagePersisted }),
      ...(options.now === undefined ? {} : { now: options.now })
    }));
    ciRepair = {
      ...ciRepair,
      task: orchestratorTask
    };

    assertNoRunningCiRepairOrchestratorWorker({
      database,
      task: orchestratorTask
    });

    const workerRun = startWorkerRun({
      database,
      task: orchestratorTask,
      workerType: "ci_repair_orchestrator",
      enforcementLevel: "policy_enforced",
      ...(options.now === undefined ? {} : { now: options.now })
    });

    let completedWorkerResult: CiRepairWorkerResult | undefined;

    try {
      const preparedWorkspace = await prepareCiRepairWorkspace({
        cwd,
        root,
        stateDb,
        database,
        policy,
        task: orchestratorTask,
        workerRun,
        context: stageContext,
        branchName,
        base,
        ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
        ...(options.onStagePersisted === undefined
          ? {}
          : { onStagePersisted: options.onStagePersisted }),
        ...(options.now === undefined ? {} : { now: options.now })
      });
      orchestratorTask = preparedWorkspace.task;
      stageContext = preparedWorkspace.context;
      const { checkpointBefore } = preparedWorkspace;

      const workerStage = await executeCiRepairWorkerStage({
        cwd,
        root,
        stateDb,
        database,
        policy,
        goal,
        task: orchestratorTask,
        workerRun,
        context: stageContext,
        ciRepair,
        checkpointBefore,
        options
      });
      orchestratorTask = workerStage.task;
      stageContext = workerStage.context;
      const workerResult = workerStage.workerResult;
      completedWorkerResult = workerResult;

      const terminalWorkerOutcome = await handleCiRepairWorkerTerminalOutcome({
        cwd,
        root,
        stateDb,
        database,
        policy,
        task: orchestratorTask,
        workerRun,
        workerResult,
        stageContext,
        ciRepair,
        branchName,
        ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
        ...(options.now === undefined ? {} : { now: options.now })
      });

      if (terminalWorkerOutcome !== undefined) {
        return terminalWorkerOutcome;
      }

      return await executeCiRepairPublishStage({
        cwd,
        root,
        stateDb,
        database,
        policy,
        task: orchestratorTask,
        workerRun,
        context: stageContext,
        ciRepair,
        branchName,
        base,
        workerResult,
        options,
        onOrchestratorStateUpdated: (state) => {
          orchestratorTask = state.task;
          stageContext = state.context;
        }
      });
    } catch (error) {
      const handled = handleCiRepairOrchestratorError({
        error,
        database,
        task: orchestratorTask,
        workerRun,
        context: stageContext,
        ciRepair,
        branchName,
        ...(completedWorkerResult === undefined ? {} : { completedWorkerResult }),
        ...(options.now === undefined ? {} : { now: options.now })
      });

      if (handled !== undefined) {
        return handled;
      }

      throw error;
    }
  } finally {
    database.close();
  }
}

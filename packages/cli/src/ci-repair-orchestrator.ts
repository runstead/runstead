import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import { runGovernedToolAction } from "./governed-action.js";
import { showGoal } from "./goals.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadRootSync } from "./runstead-root.js";
import { startWorkerRun } from "./runtime-audit.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import type {
  CiRepairWorkerResult,
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import { workerStartAction } from "./ci-repair-orchestrator-actions.js";
import {
  durableWorkerResult,
  workerOutput
} from "./ci-repair-orchestrator-worker-output.js";
import {
  buildPullRequestResumeContext,
  incrementCiRepairCounter,
  stageAtLeast,
  type CiRepairOrchestratorResumeContext
} from "./ci-repair-orchestrator-context.js";
import { claimCiRepairOrchestratorTask } from "./ci-repair-orchestrator-claim.js";
import { prepareCiRepairOrchestratorIntake } from "./ci-repair-orchestrator-intake.js";
import { writeCiRepairStage } from "./ci-repair-orchestrator-stage-persistence.js";
import { startCiRepairWorker } from "./ci-repair-orchestrator-worker-run.js";
import { handleCiRepairWorkerTerminalOutcome } from "./ci-repair-orchestrator-worker-terminal.js";
import { prepareCiRepairWorkspace } from "./ci-repair-orchestrator-workspace.js";
import { publishCiRepairPullRequest } from "./ci-repair-orchestrator-publish-flow.js";
import { verifyCiRepairWorkerChanges } from "./ci-repair-orchestrator-verification.js";
import {
  assertNoRunningCiRepairOrchestratorWorker,
  findPullRequestResumeTask,
  resumeCiRepairPullRequest
} from "./ci-repair-orchestrator-resume.js";
import { handleCiRepairOrchestratorError } from "./ci-repair-orchestrator-error-handling.js";

export {
  ciRepairPullRequestResumeRunId,
  isCiRepairPullRequestResumeTask
} from "./ci-repair-orchestrator-resume.js";

export { formatCiRepairOrchestratorReport } from "./ci-repair-orchestrator-report.js";

export type {
  CiRepairGitRunner,
  CiRepairWorkerKind,
  CiRepairWorkerResult,
  CodexDirectCiRepairWorkerResult,
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
export { ciRepairProgressStageAtLeast } from "./ci-repair-orchestrator-stage.js";

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

      let workerResult = stageContext.workerResult;

      if (
        !stageAtLeast(stageContext.stage, "worker_completed") ||
        workerResult === undefined
      ) {
        workerResult = await runGovernedToolAction({
          cwd,
          stateDb,
          database,
          policy,
          task: orchestratorTask,
          workerRun,
          action: workerStartAction({
            task: orchestratorTask,
            cwd,
            worker: options.worker
          }),
          requestedBy: "runstead:ci-repair",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            const value = await startCiRepairWorker({
              cwd,
              root,
              stateDb,
              database,
              policy,
              goal,
              task: orchestratorTask,
              worker: options.worker,
              ...(options.provider === undefined ? {} : { provider: options.provider }),
              ...(options.model === undefined ? {} : { model: options.model }),
              ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
              checkpointBefore,
              workflowRunId: ciRepair.workflowRun.runId,
              evidenceId: ciRepair.evidence.id,
              verifierCommands: options.verifierCommands,
              allowedPaths: options.allowedPaths ?? [],
              deniedPaths: options.deniedPaths ?? [],
              ...(options.workerRunner === undefined
                ? {}
                : { workerRunner: options.workerRunner }),
              ...(options.codexDirectTransport === undefined
                ? {}
                : { codexDirectTransport: options.codexDirectTransport }),
              ...(options.now === undefined ? {} : { now: options.now })
            });

            return {
              value,
              output: workerOutput(value)
            };
          }
        }).then((result) => result.value);
        stageContext = {
          ...stageContext,
          counters: incrementCiRepairCounter(stageContext, "workerAttempt")
        };
        if (workerResult === undefined) {
          throw new Error("CI repair worker result context is missing");
        }
        ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
          database,
          task: orchestratorTask,
          context: stageContext,
          stage: "worker_completed",
          patch: {
            workerResult: durableWorkerResult(workerResult)
          },
          ...(options.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: options.onStagePersisted }),
          ...(options.now === undefined ? {} : { now: options.now })
        }));
      }
      completedWorkerResult = workerResult;

      if (workerResult === undefined) {
        throw new Error("CI repair worker result context is missing");
      }

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

      const verifiedChanges = await verifyCiRepairWorkerChanges({
        cwd,
        root,
        stateDb,
        database,
        policy,
        task: orchestratorTask,
        workerRun,
        context: stageContext,
        ciRepair,
        base,
        workerResult,
        ...(options.allowedPaths === undefined
          ? {}
          : { allowedPaths: options.allowedPaths }),
        ...(options.deniedPaths === undefined
          ? {}
          : { deniedPaths: options.deniedPaths }),
        ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
        ...(options.verifierRunner === undefined
          ? {}
          : { verifierRunner: options.verifierRunner }),
        ...(options.onStagePersisted === undefined
          ? {}
          : { onStagePersisted: options.onStagePersisted }),
        ...(options.now === undefined ? {} : { now: options.now })
      });
      orchestratorTask = verifiedChanges.task;
      stageContext = verifiedChanges.context;
      const {
        commit,
        diffScope,
        verifierResult: normalizedVerifierResult
      } = verifiedChanges;

      const resumeContext: CiRepairOrchestratorResumeContext = {
        ...stageContext,
        ...buildPullRequestResumeContext({
          ciRepair,
          branchName,
          base,
          draft: options.draft === true,
          workerResult,
          ...(commit === undefined ? {} : { commit }),
          diffScope,
          verifierResult: normalizedVerifierResult
        })
      };
      ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
        database,
        task: orchestratorTask,
        context: resumeContext,
        stage: "ready_for_push",
        ...(options.onStagePersisted === undefined
          ? {}
          : { onStagePersisted: options.onStagePersisted }),
        ...(options.now === undefined ? {} : { now: options.now })
      }));

      const publishResult = await publishCiRepairPullRequest({
        cwd,
        stateDb,
        database,
        policy,
        task: orchestratorTask,
        workerRun,
        ciRepair,
        context: stageContext as CiRepairOrchestratorResumeContext,
        ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
        ...(options.githubRunner === undefined
          ? {}
          : { githubRunner: options.githubRunner }),
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
        ...(options.onStagePersisted === undefined
          ? {}
          : { onStagePersisted: options.onStagePersisted }),
        ...(options.now === undefined ? {} : { now: options.now })
      });

      if (publishResult.status === "waiting_approval") {
        return {
          status: "waiting_approval",
          ciRepair: {
            ...ciRepair,
            task: publishResult.task
          },
          branchName,
          workerResult,
          ...(commit === undefined ? {} : { commit }),
          diffScope,
          verifierResult: {
            ...normalizedVerifierResult,
            task: publishResult.task
          },
          approval: publishResult.approval
        };
      }

      return {
        status: "completed",
        ciRepair: {
          ...ciRepair,
          task: publishResult.task
        },
        branchName,
        workerResult,
        ...(commit === undefined ? {} : { commit }),
        diffScope,
        verifierResult: {
          ...normalizedVerifierResult,
          task: publishResult.task
        },
        pullRequest: publishResult.pullRequest
      };
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

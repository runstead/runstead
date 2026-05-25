import { join, resolve } from "node:path";

import { openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  createCiRepairTaskFromWorkflowRunUnlocked,
  isCreatedCiRepairTaskResult,
  type CreateCiRepairTaskResult
} from "./ci-repair.js";
import { buildRunsteadBranchName } from "./git-branch.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import {
  ciRepairApprovalRecord,
  ciRepairApprovalSummary
} from "./ci-repair-orchestrator-approval.js";
import { showGoal } from "./goals.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadRootSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { claimTask } from "./tasks.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import type {
  CiRepairWorkerResult,
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import { workerStartAction } from "./ci-repair-orchestrator-actions.js";
import {
  durableWorkerResult,
  isCodexDirectWorkerResult,
  workerFailureText,
  workerOutput
} from "./ci-repair-orchestrator-worker-output.js";
import {
  buildInitialCiRepairStageContext,
  buildPullRequestResumeContext,
  ciRepairStageContext,
  incrementCiRepairCounter,
  stageAtLeast,
  type CiRepairOrchestratorResumeContext
} from "./ci-repair-orchestrator-context.js";
import {
  isStagePersistenceInterruption,
  markTaskTerminal
} from "./ci-repair-orchestrator-task-state.js";
import {
  writeCiRepairContextPatch,
  writeCiRepairStage
} from "./ci-repair-orchestrator-stage-persistence.js";
import {
  rollbackWorkerChanges,
  startCiRepairWorker
} from "./ci-repair-orchestrator-worker-run.js";
import { prepareCiRepairWorkspace } from "./ci-repair-orchestrator-workspace.js";
import { publishCiRepairPullRequest } from "./ci-repair-orchestrator-publish-flow.js";
import { verifyCiRepairWorkerChanges } from "./ci-repair-orchestrator-verification.js";
import {
  assertNoRunningCiRepairOrchestratorWorker,
  findPullRequestResumeTask,
  resumeCiRepairPullRequest
} from "./ci-repair-orchestrator-resume.js";

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

  if (options.verifierCommands.length === 0) {
    throw new Error("At least one verifier command is required for CI repair");
  }

  const stateDb = join(root, "state.db");
  const policy = await loadPolicyProfileFromFile(
    join(root, "policies", "repo-maintenance.yaml")
  );
  const queuedCiRepair = await createCiRepairTaskFromWorkflowRunUnlocked({
    cwd,
    runId: options.runId,
    verifierCommands: options.verifierCommands,
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    ...(options.githubRunner === undefined ? {} : { runner: options.githubRunner }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  if (!isCreatedCiRepairTaskResult(queuedCiRepair)) {
    return {
      status: "ignored",
      ciRepair: queuedCiRepair
    };
  }

  if (queuedCiRepair.task.status !== "queued") {
    throw new Error(
      `CI repair task ${queuedCiRepair.task.id} is ${queuedCiRepair.task.status}, expected queued`
    );
  }

  let ciRepair: CreateCiRepairTaskResult = {
    ...queuedCiRepair,
    task: claimTask({
      cwd,
      id: queuedCiRepair.task.id,
      ...(options.now === undefined ? {} : { now: options.now })
    }).task
  };
  const goal = showGoal({ cwd, id: ciRepair.task.goalId }).goal;
  const base = options.base ?? ciRepair.workflowRun.headBranch ?? "main";
  const branchName = buildRunsteadBranchName({
    taskId: ciRepair.task.id,
    slug: `ci-${ciRepair.workflowRun.runId}`
  });
  const database = openRunsteadDatabase(stateDb);
  let orchestratorTask = ciRepair.task;
  const restoredStageContext = ciRepairStageContext(queuedCiRepair.task);
  let stageContext =
    restoredStageContext ??
    buildInitialCiRepairStageContext({
      ciRepair,
      branchName,
      base,
      draft: options.draft === true,
      worker: options.worker,
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl })
    });

  try {
    if (restoredStageContext !== undefined) {
      ({ task: orchestratorTask, context: stageContext } = writeCiRepairContextPatch({
        database,
        task: orchestratorTask,
        context: stageContext,
        patch: {
          counters: incrementCiRepairCounter(stageContext, "orchestratorAttempt")
        },
        ...(options.now === undefined ? {} : { now: options.now })
      }));
    }

    if (!stageAtLeast(stageContext.stage, "intake_completed")) {
      ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
        database,
        task: orchestratorTask,
        context: stageContext,
        stage: "intake_completed",
        ...(options.onStagePersisted === undefined
          ? {}
          : { onStagePersisted: options.onStagePersisted }),
        ...(options.now === undefined ? {} : { now: options.now })
      }));
    }
    if (!stageAtLeast(stageContext.stage, "claimed")) {
      ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
        database,
        task: orchestratorTask,
        context: stageContext,
        stage: "claimed",
        ...(options.onStagePersisted === undefined
          ? {}
          : { onStagePersisted: options.onStagePersisted }),
        ...(options.now === undefined ? {} : { now: options.now })
      }));
    }
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

      if (
        isCodexDirectWorkerResult(workerResult) &&
        workerResult.status === "waiting_approval"
      ) {
        const waitingContext = {
          ...stageContext,
          counters: incrementCiRepairCounter(stageContext, "approvalRound")
        };
        const waitingTask = markTaskTerminal({
          database,
          task: orchestratorTask,
          status: "waiting_approval",
          output: {
            ...(orchestratorTask.output ?? {}),
            summary: "Codex Direct worker requires approval",
            ciRepairOrchestrator: {
              ...waitingContext,
              approvalId: workerResult.approval?.id
            },
            ...(workerResult.approval === undefined
              ? {}
              : {
                  approval: {
                    id: workerResult.approval.id,
                    status: "pending",
                    actionId: workerResult.approval.actionId,
                    policyDecisionId: workerResult.approval.policyDecisionId,
                    reason: workerResult.approval.reason
                  }
                })
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "waiting_approval",
          output: workerOutput(workerResult),
          ...(options.now === undefined ? {} : { now: options.now })
        });

        return {
          status: "waiting_approval",
          ciRepair: {
            ...ciRepair,
            task: waitingTask
          },
          branchName,
          workerResult,
          ...(workerResult.approval === undefined
            ? {}
            : { approval: workerResult.approval })
        };
      }

      if (
        isCodexDirectWorkerResult(workerResult) &&
        workerResult.status === "blocked"
      ) {
        await rollbackWorkerChanges({
          cwd,
          root,
          stateDb,
          database,
          policy,
          task: orchestratorTask,
          workerRun,
          workerResult,
          ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        markTaskTerminal({
          database,
          task: orchestratorTask,
          status: "blocked",
          output: {
            ...(orchestratorTask.output ?? {}),
            summary: workerResult.summary,
            ciRepairOrchestrator: {
              ...stageContext,
              stage: "blocked"
            }
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "blocked",
          output: workerOutput(workerResult),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        throw new Error(workerResult.summary);
      }

      if (workerResult.exitCode !== 0) {
        await rollbackWorkerChanges({
          cwd,
          root,
          stateDb,
          database,
          policy,
          task: orchestratorTask,
          workerRun,
          workerResult,
          ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        markTaskTerminal({
          database,
          task: orchestratorTask,
          status: "failed",
          output: {
            ...(orchestratorTask.output ?? {}),
            summary: "CI repair worker failed",
            ciRepairOrchestrator: {
              ...stageContext,
              stage: "failed"
            },
            exitCode: workerResult.exitCode,
            stderrBytes: Buffer.byteLength(workerFailureText(workerResult), "utf8"),
            stderrOmitted: workerFailureText(workerResult).length > 0
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "failed",
          output: workerOutput(workerResult),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        throw new Error(
          `CI repair worker exited ${workerResult.exitCode}: ${workerFailureText(workerResult)}`
        );
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
      if (isStagePersistenceInterruption(error)) {
        throw error;
      }

      if (error instanceof ToolActionApprovalRequiredError) {
        const waitingContext = {
          ...stageContext,
          counters: incrementCiRepairCounter(stageContext, "approvalRound")
        };
        const waitingTask = markTaskTerminal({
          database,
          task: orchestratorTask,
          status: "waiting_approval",
          output: {
            ...(orchestratorTask.output ?? {}),
            summary: `${error.toolCall.actionType} requires approval`,
            ciRepairOrchestrator: {
              ...waitingContext,
              approvalId: error.approval.id
            },
            approval: ciRepairApprovalRecord(error)
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "waiting_approval",
          output: {
            approvalId: error.approval.id,
            actionType: error.toolCall.actionType
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });

        return {
          status: "waiting_approval",
          ciRepair: {
            ...ciRepair,
            task: waitingTask
          },
          branchName,
          ...(completedWorkerResult === undefined
            ? {}
            : { workerResult: completedWorkerResult }),
          approval: ciRepairApprovalSummary(error)
        };
      }

      if (error instanceof ToolActionDeniedError) {
        markTaskTerminal({
          database,
          task: orchestratorTask,
          status: "blocked",
          output: {
            ...(orchestratorTask.output ?? {}),
            summary: error.message,
            ciRepairOrchestrator: {
              ...stageContext,
              stage: "blocked"
            },
            policyDecisionId: error.policyDecision.id
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "blocked",
          output: {
            error: error.message,
            policyDecisionId: error.policyDecision.id
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
      }

      throw error;
    }
  } finally {
    database.close();
  }
}

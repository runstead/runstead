import { join, resolve } from "node:path";

import { type Evidence, type Task } from "@runstead/core";
import { openRunsteadDatabase, type RunsteadDatabase } from "@runstead/state-sqlite";

import {
  createCiRepairTaskFromWorkflowRunUnlocked,
  isCreatedCiRepairTaskResult,
  type CreateCiRepairTaskResult
} from "./ci-repair.js";
import {
  createWorkspaceCheckpoint,
  recordWorkspaceCheckpointCreatedEvent
} from "./checkpoints.js";
import {
  buildRunsteadBranchName,
  commitGitChanges,
  createGitBranch,
  listGitChangedFiles
} from "./git-branch.js";
import type { GitHubCliRunner, GitHubWorkflowRunLog } from "./github-actions.js";
import {
  runGovernedToolAction,
  ToolActionApprovalRequiredError,
  ToolActionDeniedError
} from "./governed-action.js";
import { showGoal } from "./goals.js";
import { loadPolicyProfileFromFile } from "./policy-loader.js";
import { requireRunsteadRootSync } from "./runstead-root.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import { claimTask, listTasks } from "./tasks.js";
import {
  runTaskVerifiersUnlocked,
  type RunTaskVerifiersResult
} from "./verifier-runner.js";
import { verifyGitDiffScope } from "./diff-scope-verifier.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import type {
  CiRepairGitRunner,
  CiRepairWorkerResult,
  RunCiRepairOrchestratorOptions,
  RunCiRepairOrchestratorResult
} from "./ci-repair-orchestrator-types.js";
import type { CiRepairOrchestratorStage } from "./ci-repair-orchestrator-stage.js";
import {
  checkpointCreateAction,
  gitBranchCreateAction,
  gitCommitAction,
  gitDiffAction,
  gitStatusAction,
  workerStartAction
} from "./ci-repair-orchestrator-actions.js";
import {
  durableWorkerResult,
  isCodexDirectWorkerResult,
  workerFailureText,
  workerOutput
} from "./ci-repair-orchestrator-worker-output.js";
import {
  checkpointOutput,
  diffScopeOutput,
  gitChangedFilesOutput,
  gitCommitOutput,
  pullRequestOutput
} from "./ci-repair-orchestrator-output.js";
import {
  buildInitialCiRepairStageContext,
  buildPullRequestResumeContext,
  ciRepairStageContext,
  incrementCiRepairCounter,
  parsePullRequestResumeContext,
  publishCoverageFromContext,
  publishCoverageStagePatch,
  pullRequestResumeContext,
  stageAtLeast,
  type CiRepairOrchestratorResumeContext,
  type CiRepairOrchestratorStageContext
} from "./ci-repair-orchestrator-context.js";
import {
  failCiRepairOrchestratorRun,
  isStagePersistenceInterruption,
  markTaskTerminal,
  taskEvent,
  writeTaskOutput
} from "./ci-repair-orchestrator-task-state.js";
import {
  rollbackWorkerChanges,
  startCiRepairWorker
} from "./ci-repair-orchestrator-worker-run.js";
import {
  createRepairPullRequestWithPublishApproval,
  ensureGovernedRepairPublishApproval,
  pushRepairBranchWithPublishApproval
} from "./ci-repair-orchestrator-publish.js";

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
      if (!stageAtLeast(stageContext.stage, "branch_created")) {
        await runGovernedToolAction({
          cwd,
          stateDb,
          database,
          policy,
          task: orchestratorTask,
          workerRun,
          action: gitBranchCreateAction({
            task: orchestratorTask,
            cwd,
            branchName,
            base
          }),
          requestedBy: "runstead:ci-repair",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            const value = await createGitBranch({
              cwd,
              branchName,
              baseRef: base,
              ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
            });

            return {
              value,
              output: {
                branchName: value.branchName,
                baseRef: value.baseRef ?? base
              }
            };
          }
        });
        ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
          database,
          task: orchestratorTask,
          context: stageContext,
          stage: "branch_created",
          patch: {
            branchName,
            base
          },
          ...(options.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: options.onStagePersisted }),
          ...(options.now === undefined ? {} : { now: options.now })
        }));
      }

      let checkpointBefore = stageContext.checkpointBefore;

      if (
        !stageAtLeast(stageContext.stage, "checkpoint_created") ||
        checkpointBefore === undefined
      ) {
        const checkpointResult = await runGovernedToolAction({
          cwd,
          stateDb,
          database,
          policy,
          task: orchestratorTask,
          workerRun,
          action: checkpointCreateAction({
            task: orchestratorTask,
            cwd,
            checkpointDir: join(root, "checkpoints")
          }),
          requestedBy: "runstead:ci-repair",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            const value = await createWorkspaceCheckpoint({
              workspace: cwd,
              checkpointDir: join(root, "checkpoints"),
              ...(options.now === undefined ? {} : { now: options.now }),
              ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
            });
            recordWorkspaceCheckpointCreatedEvent({
              stateDb,
              checkpoint: value,
              actor: "runstead:ci-repair",
              ...(options.now === undefined ? {} : { now: options.now })
            });

            return {
              value,
              output: checkpointOutput(value)
            };
          }
        });
        checkpointBefore = checkpointResult.value;
        ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
          database,
          task: orchestratorTask,
          context: stageContext,
          stage: "checkpoint_created",
          patch: {
            checkpointBefore
          },
          ...(options.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: options.onStagePersisted }),
          ...(options.now === undefined ? {} : { now: options.now })
        }));
      }

      if (checkpointBefore === undefined) {
        throw new Error("CI repair checkpoint context is missing");
      }

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

      const changedFiles = await runGovernedToolAction({
        cwd,
        stateDb,
        database,
        policy,
        task: orchestratorTask,
        workerRun,
        action: gitStatusAction({
          task: orchestratorTask,
          cwd
        }),
        requestedBy: "runstead:ci-repair",
        ...(options.now === undefined ? {} : { now: options.now }),
        run: async () => {
          const value = await listGitChangedFiles({
            cwd,
            ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
          });

          return {
            value,
            output: gitChangedFilesOutput(value)
          };
        }
      }).then((result) => result.value);
      const hasCommittableChanges =
        changedFiles.changedFiles.length > changedFiles.excludedFiles.length;
      let commit = stageContext.commit;

      if (
        (!stageAtLeast(stageContext.stage, "committed") || commit === undefined) &&
        hasCommittableChanges
      ) {
        commit = await runGovernedToolAction({
          cwd,
          stateDb,
          database,
          policy,
          task: orchestratorTask,
          workerRun,
          action: gitCommitAction({
            task: orchestratorTask,
            cwd,
            changedFiles: changedFiles.changedFiles
          }),
          requestedBy: "runstead:ci-repair",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            const value = await commitGitChanges({
              cwd,
              message: `Runstead repair CI run ${ciRepair.workflowRun.runId}`,
              changedFiles: changedFiles.changedFiles,
              ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
            });

            return {
              value,
              output: gitCommitOutput(value)
            };
          }
        }).then((result) => result.value);
        if (commit === undefined) {
          throw new Error("CI repair commit context is missing");
        }
        ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
          database,
          task: orchestratorTask,
          context: stageContext,
          stage: "committed",
          patch: {
            commit
          },
          ...(options.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: options.onStagePersisted }),
          ...(options.now === undefined ? {} : { now: options.now })
        }));
      }

      let diffScope = stageContext.diffScope;

      if (!stageAtLeast(stageContext.stage, "verified") || diffScope === undefined) {
        diffScope = await runGovernedToolAction({
          cwd,
          stateDb,
          database,
          policy,
          task: orchestratorTask,
          workerRun,
          action: gitDiffAction({
            task: orchestratorTask,
            cwd,
            base,
            head: "HEAD"
          }),
          requestedBy: "runstead:ci-repair",
          ...(options.now === undefined ? {} : { now: options.now }),
          run: async () => {
            const value = await verifyGitDiffScope({
              cwd,
              baseRef: base,
              headRef: "HEAD",
              allowedPaths: options.allowedPaths ?? [],
              deniedPaths: options.deniedPaths ?? [],
              ...(options.gitRunner === undefined ? {} : { runner: options.gitRunner })
            });

            return {
              value,
              output: diffScopeOutput(value)
            };
          }
        }).then((result) => result.value);
      }

      if (diffScope === undefined) {
        throw new Error("CI repair diff scope context is missing");
      }

      if (diffScope.changedFiles.length === 0) {
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
            ciRepairOrchestrator: {
              ...stageContext,
              stage: "failed"
            },
            summary: "CI repair produced no git diff"
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "failed",
          output: diffScopeOutput(diffScope),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        throw new Error("CI repair produced no git diff");
      }

      if (!diffScope.passed) {
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
            ciRepairOrchestrator: {
              ...stageContext,
              stage: "failed"
            },
            summary: "CI repair diff scope failed",
            violations: diffScope.violations
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "failed",
          output: diffScopeOutput(diffScope),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        throw new Error(
          `CI repair diff scope failed with ${diffScope.violations.length} violation(s)`
        );
      }

      const verifierResult =
        stageAtLeast(stageContext.stage, "verified") &&
        stageContext.verifierTask !== undefined &&
        stageContext.verifierCommandResults !== undefined
          ? {
              task: stageContext.verifierTask,
              commandResults: stageContext.verifierCommandResults
            }
          : await (options.verifierRunner ?? runTaskVerifiersUnlocked)({
              cwd,
              taskId: orchestratorTask.id,
              claim: false,
              mode: "evidence_only",
              ...(options.now === undefined ? {} : { now: options.now })
            });
      const normalizedVerifierResult: RunTaskVerifiersResult = {
        ...verifierResult,
        task: {
          ...verifierResult.task,
          goalId: ciRepair.task.goalId,
          input: ciRepair.task.input,
          verifiers: ciRepair.task.verifiers,
          createdAt: ciRepair.task.createdAt
        }
      };

      if (normalizedVerifierResult.task.status !== "completed") {
        await rollbackWorkerChanges({
          cwd,
          root,
          stateDb,
          database,
          policy,
          task: normalizedVerifierResult.task,
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
            summary: "CI repair verifier failed",
            verifierTaskStatus: normalizedVerifierResult.task.status,
            ciRepairOrchestrator: {
              ...stageContext,
              stage: "failed"
            }
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        finishWorkerRun({
          database,
          workerRun,
          status: "failed",
          output: {
            verifierTaskStatus: normalizedVerifierResult.task.status
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });
        throw new Error(
          `CI repair verifier ended with task status ${normalizedVerifierResult.task.status}`
        );
      }

      if (!stageAtLeast(stageContext.stage, "verified")) {
        ({ task: orchestratorTask, context: stageContext } = writeCiRepairStage({
          database,
          task: orchestratorTask,
          context: stageContext,
          stage: "verified",
          patch: {
            diffScope,
            verifierTask: normalizedVerifierResult.task,
            verifierCommandResults: normalizedVerifierResult.commandResults
          },
          ...(options.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: options.onStagePersisted }),
          ...(options.now === undefined ? {} : { now: options.now })
        }));
      }

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

      let publishTask = orchestratorTask;
      let publishContext = stageContext as CiRepairOrchestratorResumeContext;

      try {
        if (!stageAtLeast(publishContext.stage, "branch_pushed")) {
          let publishCoverage = publishCoverageFromContext(publishContext);

          if (
            !stageAtLeast(publishContext.stage, "publish_approved") ||
            publishCoverage === undefined
          ) {
            publishCoverage = await ensureGovernedRepairPublishApproval({
              cwd,
              stateDb,
              database,
              policy,
              task: publishTask,
              workerRun,
              context: publishContext,
              ...(options.now === undefined ? {} : { now: options.now })
            });
            publishContext = {
              ...publishContext,
              counters: incrementCiRepairCounter(publishContext, "publishAttempt")
            };
            ({ task: publishTask, context: publishContext } = writeCiRepairStage({
              database,
              task: publishTask,
              context: publishContext,
              stage: "publish_approved",
              patch: publishCoverageStagePatch(publishCoverage),
              ...(options.onStagePersisted === undefined
                ? {}
                : { onStagePersisted: options.onStagePersisted }),
              ...(options.now === undefined ? {} : { now: options.now })
            }) as {
              task: Task;
              context: CiRepairOrchestratorResumeContext;
            });
          }
          await pushRepairBranchWithPublishApproval({
            cwd,
            stateDb,
            database,
            policy,
            task: publishTask,
            workerRun,
            context: publishContext,
            coverage: publishCoverage,
            ...(publishContext.approvalId === undefined
              ? {}
              : { approvalId: publishContext.approvalId }),
            ...(options.gitRunner === undefined
              ? {}
              : { gitRunner: options.gitRunner }),
            ...(options.now === undefined ? {} : { now: options.now })
          });
          ({ task: publishTask, context: publishContext } = writeCiRepairStage({
            database,
            task: publishTask,
            context: publishContext,
            stage: "branch_pushed",
            patch: {
              branchPushed: true,
              ...publishCoverageStagePatch(publishCoverage)
            },
            ...(options.onStagePersisted === undefined
              ? {}
              : { onStagePersisted: options.onStagePersisted }),
            ...(options.now === undefined ? {} : { now: options.now })
          }) as {
            task: Task;
            context: CiRepairOrchestratorResumeContext;
          });
        }

        const publishCoverage = publishCoverageFromContext(publishContext);
        const pullRequest = await createRepairPullRequestWithPublishApproval({
          cwd,
          stateDb,
          database,
          policy,
          task: publishTask,
          workerRun,
          ciRepair,
          context: publishContext,
          ...(publishCoverage === undefined ? {} : { coverage: publishCoverage }),
          ...(publishContext.approvalId === undefined
            ? {}
            : { approvalId: publishContext.approvalId }),
          ...(options.githubRunner === undefined
            ? {}
            : { githubRunner: options.githubRunner }),
          ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        const completedTask = writeTaskOutput({
          database,
          task: publishTask,
          status: "completed",
          output: {
            ...(publishTask.output ?? {}),
            ciRepairOrchestrator: {
              ...publishContext,
              stage: "completed",
              pullRequest
            }
          },
          eventType: "task.completed",
          ...(options.now === undefined ? {} : { now: options.now })
        });

        finishWorkerRun({
          database,
          workerRun,
          status: "completed",
          output: {
            pullRequest: pullRequestOutput(pullRequest)
          },
          ...(options.now === undefined ? {} : { now: options.now })
        });

        return {
          status: "completed",
          ciRepair: {
            ...ciRepair,
            task: completedTask
          },
          branchName,
          workerResult,
          ...(commit === undefined ? {} : { commit }),
          diffScope,
          verifierResult: {
            ...normalizedVerifierResult,
            task: completedTask
          },
          pullRequest
        };
      } catch (error) {
        if (isStagePersistenceInterruption(error)) {
          throw error;
        }

        if (error instanceof ToolActionApprovalRequiredError) {
          const approvalStage =
            error.toolCall.actionType === "repo.publish_repair"
              ? "publish_approval_requested"
              : error.toolCall.actionType === "git.push"
                ? "push_approval_requested"
                : "pr_approval_requested";
          const waitingContext = {
            ...publishContext,
            counters: incrementCiRepairCounter(publishContext, "approvalRound")
          };
          const waitingTask = markTaskTerminal({
            database,
            task: publishTask,
            status: "waiting_approval",
            output: {
              ...(publishTask.output ?? {}),
              ciRepairOrchestrator: {
                ...waitingContext,
                stage: approvalStage,
                approvalId: error.approval.id
              }
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
            workerResult,
            ...(commit === undefined ? {} : { commit }),
            diffScope,
            verifierResult: {
              ...normalizedVerifierResult,
              task: waitingTask
            },
            approval: approvalSummary(error)
          };
        }

        if (error instanceof ToolActionDeniedError) {
          throw error;
        }

        failCiRepairOrchestratorRun({
          database,
          task: publishTask,
          workerRun,
          summary: "CI repair publish failed",
          error,
          ...(options.now === undefined ? {} : { now: options.now })
        });

        throw error;
      }
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
            approval: {
              id: error.approval.id,
              status: error.approval.status,
              actionId: error.approval.actionId,
              policyDecisionId: error.approval.policyDecisionId,
              reason: error.approval.reason
            }
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
          approval: approvalSummary(error)
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

async function resumeCiRepairPullRequest(options: {
  cwd: string;
  root: string;
  task: Task;
  authToken?: string;
  githubRunner?: GitHubCliRunner;
  gitRunner?: CiRepairGitRunner;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}): Promise<RunCiRepairOrchestratorResult> {
  const task =
    options.task.status === "queued"
      ? claimTask({
          cwd: options.cwd,
          id: options.task.id,
          ...(options.now === undefined ? {} : { now: options.now })
        }).task
      : options.task;
  const context = parsePullRequestResumeContext(task);
  const stateDb = join(options.root, "state.db");
  const policy = await loadPolicyProfileFromFile(
    join(options.root, "policies", "repo-maintenance.yaml")
  );
  const database = openRunsteadDatabase(stateDb);
  const ciRepair = ciRepairResultFromResume({
    cwd: options.cwd,
    stateDb,
    task,
    context
  });

  try {
    assertNoRunningCiRepairOrchestratorWorker({
      database,
      task
    });

    const workerRun = startWorkerRun({
      database,
      task,
      workerType: "ci_repair_orchestrator",
      enforcementLevel: "policy_enforced",
      ...(options.now === undefined ? {} : { now: options.now })
    });

    let resumeTask = task;
    let resumeContext = context;

    ({ task: resumeTask, context: resumeContext } = writeCiRepairContextPatch({
      database,
      task: resumeTask,
      context: resumeContext,
      patch: {
        counters: incrementCiRepairCounter(resumeContext, "orchestratorAttempt")
      },
      ...(options.now === undefined ? {} : { now: options.now })
    }) as {
      task: Task;
      context: CiRepairOrchestratorResumeContext;
    });

    try {
      if (!stageAtLeast(resumeContext.stage, "branch_pushed")) {
        let publishCoverage = publishCoverageFromContext(resumeContext);

        if (
          !stageAtLeast(resumeContext.stage, "publish_approved") ||
          publishCoverage === undefined
        ) {
          publishCoverage = await ensureGovernedRepairPublishApproval({
            cwd: options.cwd,
            stateDb,
            database,
            policy,
            task: resumeTask,
            workerRun,
            context: resumeContext,
            ...(options.now === undefined ? {} : { now: options.now })
          });
          resumeContext = {
            ...resumeContext,
            counters: incrementCiRepairCounter(resumeContext, "publishAttempt")
          };
          ({ task: resumeTask, context: resumeContext } = writeCiRepairStage({
            database,
            task: resumeTask,
            context: resumeContext,
            stage: "publish_approved",
            patch: publishCoverageStagePatch(publishCoverage),
            ...(options.onStagePersisted === undefined
              ? {}
              : { onStagePersisted: options.onStagePersisted }),
            ...(options.now === undefined ? {} : { now: options.now })
          }) as {
            task: Task;
            context: CiRepairOrchestratorResumeContext;
          });
        }
        await pushRepairBranchWithPublishApproval({
          cwd: options.cwd,
          stateDb,
          database,
          policy,
          task: resumeTask,
          workerRun,
          context: resumeContext,
          coverage: publishCoverage,
          ...(resumeContext.approvalId === undefined
            ? {}
            : { approvalId: resumeContext.approvalId }),
          ...(options.gitRunner === undefined ? {} : { gitRunner: options.gitRunner }),
          ...(options.now === undefined ? {} : { now: options.now })
        });
        ({ task: resumeTask, context: resumeContext } = writeCiRepairStage({
          database,
          task: resumeTask,
          context: resumeContext,
          stage: "branch_pushed",
          patch: {
            branchPushed: true,
            ...publishCoverageStagePatch(publishCoverage)
          },
          ...(options.onStagePersisted === undefined
            ? {}
            : { onStagePersisted: options.onStagePersisted }),
          ...(options.now === undefined ? {} : { now: options.now })
        }) as {
          task: Task;
          context: CiRepairOrchestratorResumeContext;
        });
      }

      const publishCoverage = publishCoverageFromContext(resumeContext);
      const pullRequest = await createRepairPullRequestWithPublishApproval({
        cwd: options.cwd,
        stateDb,
        database,
        policy,
        task: resumeTask,
        workerRun,
        ciRepair,
        context: resumeContext,
        ...(publishCoverage === undefined ? {} : { coverage: publishCoverage }),
        ...(resumeContext.approvalId === undefined
          ? {}
          : { approvalId: resumeContext.approvalId }),
        ...(options.githubRunner === undefined
          ? {}
          : { githubRunner: options.githubRunner }),
        ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
        ...(options.now === undefined ? {} : { now: options.now })
      });
      const completedTask = writeTaskOutput({
        database,
        task: resumeTask,
        status: "completed",
        output: {
          ...(resumeTask.output ?? {}),
          ciRepairOrchestrator: {
            ...resumeContext,
            stage: "completed",
            pullRequest
          }
        },
        eventType: "task.completed",
        ...(options.now === undefined ? {} : { now: options.now })
      });

      finishWorkerRun({
        database,
        workerRun,
        status: "completed",
        output: {
          pullRequest: pullRequestOutput(pullRequest)
        },
        ...(options.now === undefined ? {} : { now: options.now })
      });

      return {
        status: "completed",
        ciRepair: {
          ...ciRepair,
          task: completedTask
        },
        branchName: context.branchName,
        workerResult: context.workerResult,
        ...(context.commit === undefined ? {} : { commit: context.commit }),
        diffScope: context.diffScope,
        verifierResult: {
          task: completedTask,
          commandResults: context.verifierCommandResults
        },
        pullRequest
      };
    } catch (error) {
      if (isStagePersistenceInterruption(error)) {
        throw error;
      }

      if (error instanceof ToolActionApprovalRequiredError) {
        const approvalStage =
          error.toolCall.actionType === "repo.publish_repair"
            ? "publish_approval_requested"
            : error.toolCall.actionType === "git.push"
              ? "push_approval_requested"
              : "pr_approval_requested";
        const waitingContext = {
          ...resumeContext,
          counters: incrementCiRepairCounter(resumeContext, "approvalRound")
        };
        const waitingTask = markTaskTerminal({
          database,
          task: resumeTask,
          status: "waiting_approval",
          output: {
            ...(resumeTask.output ?? {}),
            ciRepairOrchestrator: {
              ...waitingContext,
              stage: approvalStage,
              approvalId: error.approval.id
            }
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
          branchName: context.branchName,
          workerResult: context.workerResult,
          ...(context.commit === undefined ? {} : { commit: context.commit }),
          diffScope: context.diffScope,
          verifierResult: {
            task: waitingTask,
            commandResults: context.verifierCommandResults
          },
          approval: approvalSummary(error)
        };
      }

      if (error instanceof ToolActionDeniedError) {
        markTaskTerminal({
          database,
          task: resumeTask,
          status: "blocked",
          output: {
            summary: error.message,
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

        throw error;
      }

      failCiRepairOrchestratorRun({
        database,
        task: resumeTask,
        workerRun,
        summary: "CI repair publish failed",
        error,
        ...(options.now === undefined ? {} : { now: options.now })
      });

      throw error;
    }
  } finally {
    database.close();
  }
}

function findPullRequestResumeTask(options: {
  cwd: string;
  runId: string;
}): Task | undefined {
  return listTasks({ cwd: options.cwd }).tasks.find((task) => {
    if (task.domain !== "repo-maintenance" || task.type !== "ci_repair") {
      return false;
    }

    if (task.status !== "queued") {
      return false;
    }

    if (String(task.input.runId) !== options.runId) {
      return false;
    }

    return pullRequestResumeContext(task) !== undefined;
  });
}

export function isCiRepairPullRequestResumeTask(task: Task): boolean {
  return (
    task.domain === "repo-maintenance" &&
    task.type === "ci_repair" &&
    task.status === "queued" &&
    pullRequestResumeContext(task) !== undefined
  );
}

export function ciRepairPullRequestResumeRunId(task: Task): string | undefined {
  return pullRequestResumeContext(task)?.runId;
}

function assertNoRunningCiRepairOrchestratorWorker(input: {
  database: RunsteadDatabase;
  task: Task;
}): void {
  const row = input.database
    .prepare(
      `
      SELECT id
      FROM worker_runs
      WHERE task_id = ? AND worker_type = 'ci_repair_orchestrator' AND status = 'running'
      ORDER BY started_at DESC, id ASC
      LIMIT 1
    `
    )
    .get(input.task.id) as { id: string } | undefined;

  if (row !== undefined) {
    throw new Error(
      `CI repair task ${input.task.id} already has a running CI repair orchestrator: ${row.id}`
    );
  }
}

function writeCiRepairStage(input: {
  database: RunsteadDatabase;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  stage: CiRepairOrchestratorStage;
  patch?: Partial<CiRepairOrchestratorStageContext>;
  onStagePersisted?: (stage: string, task: Task) => void;
  now?: Date;
}): { task: Task; context: CiRepairOrchestratorStageContext } {
  const context: CiRepairOrchestratorStageContext = {
    ...input.context,
    ...(input.patch ?? {}),
    stage: input.stage
  };
  const task = writeTaskOutput({
    database: input.database,
    task: input.task,
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: context
    },
    eventType: "task.updated",
    ...(input.now === undefined ? {} : { now: input.now })
  });
  input.onStagePersisted?.(input.stage, task);

  return {
    task,
    context
  };
}

function writeCiRepairContextPatch(input: {
  database: RunsteadDatabase;
  task: Task;
  context: CiRepairOrchestratorStageContext;
  patch: Partial<CiRepairOrchestratorStageContext>;
  now?: Date;
}): { task: Task; context: CiRepairOrchestratorStageContext } {
  const context: CiRepairOrchestratorStageContext = {
    ...input.context,
    ...input.patch
  };
  const task = writeTaskOutput({
    database: input.database,
    task: input.task,
    output: {
      ...(input.task.output ?? {}),
      ciRepairOrchestrator: context
    },
    eventType: "task.updated",
    ...(input.now === undefined ? {} : { now: input.now })
  });

  return {
    task,
    context
  };
}

function ciRepairResultFromResume(input: {
  cwd: string;
  stateDb: string;
  task: Task;
  context: CiRepairOrchestratorResumeContext;
}): CreateCiRepairTaskResult {
  const evidence: Evidence = {
    id: input.context.evidence.id,
    type: input.context.evidence.type,
    subjectType: input.context.evidence.subjectType,
    subjectId: input.context.evidence.subjectId,
    uri: input.context.evidence.uri,
    ...(input.context.evidence.hash === undefined
      ? {}
      : { hash: input.context.evidence.hash }),
    ...(input.context.evidence.summary === undefined
      ? {}
      : { summary: input.context.evidence.summary }),
    createdAt: input.context.evidence.createdAt
  };

  return {
    status: "created",
    cwd: input.cwd,
    stateDb: input.stateDb,
    task: input.task,
    event: taskEvent(
      "task.resumed",
      input.task,
      {
        runId: input.context.runId,
        stage: input.context.stage
      },
      input.task.updatedAt || input.task.createdAt
    ),
    evidence,
    evidencePath: evidence.uri,
    workflowRun: input.context.workflowRun,
    log: {
      runId: input.context.runId,
      log: "",
      byteLength: 0
    } satisfies GitHubWorkflowRunLog,
    created: false
  };
}

function approvalSummary(error: ToolActionApprovalRequiredError) {
  return {
    id: error.approval.id,
    actionId: error.approval.actionId,
    policyDecisionId: error.approval.policyDecisionId,
    reason: error.approval.reason
  };
}

import type { Goal, Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { WorkspaceCheckpoint } from "./checkpoints.js";
import type {
  CodexDirectPendingPatchResume,
  CodexDirectTransport
} from "./codex-direct-worker.js";
import { runGovernedToolAction } from "./governed-action.js";
import { createLocalAgentCheckpointIfNeeded } from "./local-agent-checkpoint.js";
import { localAgentWorkerStartAction } from "./local-agent-actions.js";
import type { LocalAgentWorkerKind } from "./local-agent-task-input.js";
import { finalizeLocalAgentTask } from "./local-agent-task-state.js";
import {
  isCodexDirectLocalAgentWorkerResult,
  localAgentExecutionSemantics,
  localAgentFailureFromError,
  localAgentFinalSummary,
  localAgentFinalTaskStatus,
  localAgentResultStatus,
  localAgentTaskOutput,
  localAgentWorkerCompleted,
  localAgentWorkerOutput,
  localAgentWorkerRunStatus
} from "./local-agent-result.js";
import { reviewLocalAgentLearning } from "./learning-review.js";
import { summarizeLocalAgentAudit } from "./local-agent-report.js";
import { localAgentTaskLearningReviewEnabled } from "./local-agent-task-input.js";
import { runLocalAgentVerifiersIfNeeded } from "./local-agent-verifier-run.js";
import { runLocalAgentWorker } from "./local-agent-worker-run.js";
import type { RunLocalAgentTaskResult } from "./local-agent-types.js";
import type { PolicyProfile } from "./policy.js";
import { finishWorkerRun, startWorkerRun } from "./runtime-audit.js";
import type { WorkerProcessProgress, WorkerProcessRunner } from "./wrapped-worker.js";

export interface RunLocalAgentTaskWithDatabaseOptions {
  cwd: string;
  root: string;
  stateDb: string;
  database: RunsteadDatabase;
  policy: PolicyProfile;
  goal: Goal;
  task: Task;
  worker: LocalAgentWorkerKind;
  model?: string;
  modelProviderResourceId?: string;
  modelProviderNetworkDomains?: string[];
  transport?: CodexDirectTransport;
  workerRunner?: WorkerProcessRunner;
  workerProgressIntervalMs?: number;
  onWorkerProgress?: (progress: WorkerProcessProgress) => void;
  pendingPatchResume?: CodexDirectPendingPatchResume;
  now?: Date;
}

export async function runLocalAgentTaskWithDatabase(
  options: RunLocalAgentTaskWithDatabaseOptions
): Promise<RunLocalAgentTaskResult> {
  const orchestratorRun = startWorkerRun({
    database: options.database,
    task: options.task,
    workerType: "local_agent_orchestrator",
    enforcementLevel: "policy_enforced",
    ...(options.now === undefined ? {} : { now: options.now })
  });
  let checkpoint: WorkspaceCheckpoint | undefined;

  try {
    checkpoint = await createLocalAgentCheckpointIfNeeded({
      ...options,
      workerRun: orchestratorRun
    });
    const governed = await runGovernedToolAction({
      cwd: options.cwd,
      stateDb: options.stateDb,
      database: options.database,
      policy: options.policy,
      task: options.task,
      workerRun: orchestratorRun,
      action: localAgentWorkerStartAction({
        task: options.task,
        cwd: options.cwd,
        worker: options.worker
      }),
      requestedBy: "runstead:local-agent",
      ...(options.now === undefined ? {} : { now: options.now }),
      run: async () => {
        const value = await runLocalAgentWorker({
          ...options,
          ...(checkpoint === undefined ? {} : { checkpoint })
        });

        return {
          value,
          output: localAgentWorkerOutput({ workerResult: value })
        };
      }
    });
    const workerResult = governed.value;
    const verifierResult = localAgentWorkerCompleted(workerResult)
      ? await runLocalAgentVerifiersIfNeeded(options)
      : undefined;
    const finalStatus = localAgentFinalTaskStatus(workerResult, verifierResult);
    const resultStatus = localAgentResultStatus(finalStatus, workerResult);
    const summary = localAgentFinalSummary(workerResult, verifierResult);
    const execution = localAgentExecutionSemantics({
      workerResult,
      ...(verifierResult === undefined ? {} : { verifierResult })
    });
    const finalTask = finalizeLocalAgentTask({
      database: options.database,
      task: options.task,
      status: finalStatus,
      output: localAgentTaskOutput({
        workerResult,
        summary,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(verifierResult === undefined ? {} : { verifierResult })
      }),
      ...(options.now === undefined ? {} : { now: options.now })
    });

    finishWorkerRun({
      database: options.database,
      workerRun: orchestratorRun,
      status: localAgentWorkerRunStatus(finalStatus),
      output: localAgentWorkerOutput({
        workerResult,
        summary,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(verifierResult === undefined ? {} : { verifierResult })
      }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const learningReview = localAgentTaskLearningReviewEnabled(finalTask)
      ? reviewLocalAgentLearning({
          cwd: options.cwd,
          database: options.database,
          goal: options.goal,
          task: options.task,
          finalTask,
          workerResult,
          ...(verifierResult === undefined ? {} : { verifierResult }),
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : undefined;

    return {
      cwd: options.cwd,
      task: finalTask,
      goal: options.goal,
      workerResult,
      status: resultStatus,
      summary,
      execution,
      audit: summarizeLocalAgentAudit(options.database, finalTask.id),
      ...(checkpoint === undefined ? {} : { checkpoint }),
      ...(verifierResult === undefined
        ? {}
        : { verifierResults: verifierResult.commandResults }),
      ...(learningReview === undefined ? {} : { learningReview }),
      ...(!isCodexDirectLocalAgentWorkerResult(workerResult) ||
      workerResult.approval === undefined
        ? {}
        : { approval: workerResult.approval })
    };
  } catch (error) {
    const failure = localAgentFailureFromError(error, checkpoint);
    const finalTask = finalizeLocalAgentTask({
      database: options.database,
      task: options.task,
      status: failure.taskStatus,
      output: failure.output,
      ...(options.now === undefined ? {} : { now: options.now })
    });

    finishWorkerRun({
      database: options.database,
      workerRun: orchestratorRun,
      status: failure.workerStatus,
      output: failure.output,
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const learningReview = localAgentTaskLearningReviewEnabled(finalTask)
      ? reviewLocalAgentLearning({
          cwd: options.cwd,
          database: options.database,
          goal: options.goal,
          task: options.task,
          finalTask,
          ...(options.now === undefined ? {} : { now: options.now })
        })
      : undefined;

    return {
      cwd: options.cwd,
      task: finalTask,
      goal: options.goal,
      status: failure.resultStatus,
      summary: String(failure.output.summary),
      execution: failure.execution,
      audit: summarizeLocalAgentAudit(options.database, finalTask.id),
      ...(checkpoint === undefined ? {} : { checkpoint }),
      ...(failure.approval === undefined ? {} : { approval: failure.approval }),
      ...(learningReview === undefined ? {} : { learningReview })
    };
  }
}

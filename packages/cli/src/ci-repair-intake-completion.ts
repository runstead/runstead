import type { Evidence, RunsteadEvent, Task } from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";
import type { CommandVerifierInput } from "@runstead/verifiers";

import type { CiFailureClassification } from "./ci-repair-classification.js";
import { writeCiRepairWorkflowRunEvidence } from "./ci-repair-evidence.js";
import {
  buildCiRepairIntakeTask,
  createCiRepairIntakeTaskUpdatedEvent
} from "./ci-repair-intake-task-update.js";
import type {
  GitHubWorkflowRunLog,
  GitHubWorkflowRunStatus
} from "./github-actions.js";

export interface CompleteCiRepairWorkflowRunIntakeInput {
  database: RunsteadDatabase;
  runsteadRoot: string;
  task: Task;
  workflowRun: GitHubWorkflowRunStatus;
  failureClassification: CiFailureClassification;
  log: GitHubWorkflowRunLog;
  verifierCommands?: CommandVerifierInput[];
  createdAt: string;
}

export interface CompleteCiRepairWorkflowRunIntakeResult {
  task: Task;
  evidence: Evidence;
  evidencePath: string;
  evidenceEvent: RunsteadEvent;
}

export async function completeCiRepairWorkflowRunIntake(
  input: CompleteCiRepairWorkflowRunIntakeInput
): Promise<CompleteCiRepairWorkflowRunIntakeResult> {
  const finalTask = buildCiRepairIntakeTask({
    task: input.task,
    workflowRun: input.workflowRun,
    failureClassification: input.failureClassification,
    ...(input.verifierCommands === undefined
      ? {}
      : { verifierCommands: input.verifierCommands }),
    updatedAt: input.createdAt
  });
  const {
    evidence,
    evidencePath,
    event: evidenceEvent
  } = await writeCiRepairWorkflowRunEvidence({
    runsteadRoot: input.runsteadRoot,
    task: finalTask,
    workflowRun: input.workflowRun,
    failureClassification: input.failureClassification,
    log: input.log,
    createdAt: input.createdAt
  });

  appendEventAndProject(input.database, {
    event: evidenceEvent,
    projection: {
      type: "evidence",
      value: evidence
    }
  });
  appendEventAndProject(input.database, {
    event: createCiRepairIntakeTaskUpdatedEvent({
      task: finalTask,
      workflowRun: input.workflowRun,
      failureClassification: input.failureClassification,
      evidenceId: evidence.id,
      createdAt: input.createdAt
    }),
    projection: {
      type: "task",
      value: finalTask
    }
  });

  return {
    task: finalTask,
    evidence,
    evidencePath,
    evidenceEvent
  };
}

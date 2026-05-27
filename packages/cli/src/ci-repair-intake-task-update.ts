import { createRunsteadId, type RunsteadEvent, type Task } from "@runstead/core";
import type { CommandVerifierInput } from "@runstead/verifiers";

import type { CiFailureClassification } from "./ci-repair-classification.js";
import { CI_LOG_EVIDENCE_METADATA } from "./ci-repair-evidence.js";
import type { GitHubWorkflowRunStatus } from "./github-actions.js";

export function buildCiRepairIntakeTask(input: {
  task: Task;
  workflowRun: GitHubWorkflowRunStatus;
  failureClassification: CiFailureClassification;
  verifierCommands?: CommandVerifierInput[];
  updatedAt: string;
}): Task {
  return {
    ...input.task,
    input: {
      source: "github_actions",
      runId: input.workflowRun.runId,
      workflowRun: input.workflowRun,
      logEvidenceType: "github_workflow_run",
      logEvidenceMetadata: CI_LOG_EVIDENCE_METADATA,
      failureClassification: input.failureClassification,
      repairPlan: {
        fetchLog: true,
        classifyFailure: true,
        runLocalVerifiers: true,
        createPullRequestWithEvidence: true
      },
      ...(input.verifierCommands === undefined
        ? {}
        : { commands: input.verifierCommands })
    },
    updatedAt: input.updatedAt
  };
}

export function createCiRepairIntakeTaskUpdatedEvent(input: {
  task: Task;
  workflowRun: GitHubWorkflowRunStatus;
  failureClassification: CiFailureClassification;
  evidenceId: string;
  createdAt: string;
}): RunsteadEvent {
  return {
    eventId: createRunsteadId("evt"),
    type: "task.updated",
    aggregateType: "task",
    aggregateId: input.task.id,
    payload: {
      runId: input.workflowRun.runId,
      workflowName: input.workflowRun.workflowName,
      conclusion: input.workflowRun.conclusion,
      failureCategory: input.failureClassification.category,
      evidenceId: input.evidenceId
    },
    createdAt: input.createdAt
  };
}

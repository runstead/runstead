import type { JsonObject, Task } from "@runstead/core";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import type { CommitGitChangesResult } from "./git-branch.js";
import {
  formatPullRequestToolPolicyLine,
  type CiRepairPullRequestAuditSummary
} from "./ci-repair-orchestrator-pr-audit.js";
import type { CiRepairWorkerResult } from "./ci-repair-orchestrator-types.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

interface CiRepairPullRequestBodyContext extends JsonObject {
  verifierCommandResults: RunTaskVerifiersResult["commandResults"];
  workerResult: CiRepairWorkerResult;
  commit?: CommitGitChangesResult;
  diffScope: GitDiffScopeVerification;
}

export function buildCiRepairPullRequestBody(
  ciRepair: CreateCiRepairTaskResult,
  verifierTask: Task,
  auditSummary?: CiRepairPullRequestAuditSummary
): string {
  const context = ciRepairPullRequestBodyContext(verifierTask);
  const approval = approvalOutput(verifierTask);
  const failureClassification = failureClassificationOutput(ciRepair.task);
  const sections = [
    `Runstead repaired GitHub Actions run ${ciRepair.workflowRun.runId}.`,
    [
      "## Runstead Task",
      `- Goal: ${verifierTask.goalId}`,
      `- Task: ${verifierTask.id}`,
      `- Status: ${verifierTask.status}`
    ].join("\n"),
    [
      "## Workflow",
      `- Workflow: ${ciRepair.workflowRun.workflowName ?? "unknown"}`,
      `- Conclusion: ${ciRepair.workflowRun.conclusion ?? "unknown"}`,
      `- Run: ${ciRepair.workflowRun.url ?? ciRepair.workflowRun.runId}`
    ].join("\n"),
    failureClassification === undefined
      ? ""
      : [
          "## Diagnosis",
          `- Category: ${failureClassification.category}`,
          `- Summary: ${failureClassification.summary}`,
          `- Confidence: ${failureClassification.confidence}`
        ].join("\n"),
    context === undefined
      ? ""
      : [
          "## Worker",
          `- Worker: ${context.workerResult.worker}`,
          `- Exit: ${context.workerResult.exitCode}`,
          ...(context.commit === undefined
            ? []
            : [`- Commit: ${context.commit.commitSha}`]),
          ...(context.workerResult.checkpointBefore === undefined
            ? []
            : [`- Checkpoint: ${context.workerResult.checkpointBefore.id}`])
        ].join("\n"),
    context === undefined
      ? ""
      : [
          "## Verification",
          `- Diff scope: ${context.diffScope.passed ? "passed" : "failed"}`,
          `- Changed files: ${context.diffScope.changedFiles.length === 0 ? "none" : context.diffScope.changedFiles.join(", ")}`,
          ...context.verifierCommandResults.map(
            (result) =>
              `- ${result.verifier}: exit=${result.exitCode ?? "unknown"} evidence=${result.evidenceId}`
          )
        ].join("\n"),
    context === undefined
      ? ""
      : [
          "## Evidence",
          `- CI log: ${ciRepair.evidence.id}`,
          ...(ciRepair.evidence.summary === undefined
            ? []
            : [`- CI summary: ${ciRepair.evidence.summary}`]),
          ...context.verifierCommandResults.map(
            (result) => `- ${result.verifier}: ${result.evidenceId}`
          )
        ].join("\n"),
    [
      "## Policy",
      approval === undefined
        ? "- Approval: not required by policy"
        : `- Approval: ${approval.id} ${approval.status}${approval.decidedBy === undefined ? "" : ` by ${approval.decidedBy}`}`,
      ...(auditSummary === undefined || auditSummary.toolCalls.length === 0
        ? []
        : auditSummary.toolCalls.map(formatPullRequestToolPolicyLine))
    ].join("\n")
  ].filter((section) => section.length > 0);

  return sections.join("\n\n");
}

function ciRepairPullRequestBodyContext(
  task: Task
): CiRepairPullRequestBodyContext | undefined {
  const value = task.output?.ciRepairOrchestrator;

  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.stage !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.branchName !== "string" ||
    typeof value.base !== "string" ||
    typeof value.publishActionId !== "string" ||
    typeof value.pushActionId !== "string" ||
    typeof value.branchPushed !== "boolean" ||
    typeof value.prActionId !== "string" ||
    typeof value.draft !== "boolean" ||
    !isRecord(value.workflowRun) ||
    !isRecord(value.evidence) ||
    !isRecord(value.verifierTask) ||
    !Array.isArray(value.verifierCommandResults) ||
    !isRecord(value.workerResult) ||
    !isRecord(value.diffScope)
  ) {
    return undefined;
  }

  return value as unknown as CiRepairPullRequestBodyContext;
}

function failureClassificationOutput(task: Task):
  | {
      category: string;
      summary: string;
      confidence: number;
    }
  | undefined {
  const value = task.input.failureClassification;

  if (
    !isRecord(value) ||
    typeof value.category !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.confidence !== "number"
  ) {
    return undefined;
  }

  return {
    category: value.category,
    summary: value.summary,
    confidence: value.confidence
  };
}

function approvalOutput(task: Task):
  | {
      id: string;
      status: string;
      decidedBy?: string;
    }
  | undefined {
  const value = task.output?.approval;

  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.status !== "string"
  ) {
    return undefined;
  }

  return {
    id: value.id,
    status: value.status,
    ...(typeof value.decidedBy === "string" ? { decidedBy: value.decidedBy } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

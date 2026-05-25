import type { JsonObject, Task } from "@runstead/core";
import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import type { GitDiffScopeVerification } from "./diff-scope-verifier.js";
import type { CommitGitChangesResult } from "./git-branch.js";
import type {
  RunCiRepairOrchestratorResult,
  CiRepairWorkerResult
} from "./ci-repair-orchestrator-types.js";
import { isCodexDirectWorkerResult } from "./ci-repair-orchestrator-worker-output.js";
import type { RunTaskVerifiersResult } from "./verifier-runner.js";

export function formatCiRepairOrchestratorReport(
  result: RunCiRepairOrchestratorResult
): string {
  if (result.status === "ignored") {
    if (result.ciRepair.status !== "ignored") {
      throw new Error(
        "Ignored CI repair orchestrator result is missing ignored intake"
      );
    }

    return [
      "Runstead CI repair orchestrator",
      "Status: ignored",
      `Reason: ${result.ciRepair.reason}`,
      `Task: ${result.ciRepair.task.id}`,
      `Task status: ${result.ciRepair.taskStatus}`,
      `Run: ${result.ciRepair.workflowRun.runId}`,
      `Conclusion: ${result.ciRepair.workflowRun.conclusion ?? "none"}`
    ].join("\n");
  }

  return [
    "Runstead CI repair orchestrator",
    `Status: ${result.status}`,
    `Task: ${result.ciRepair.task.id}`,
    `Branch: ${result.branchName}`,
    ...(result.workerResult === undefined
      ? []
      : [`Worker: ${result.workerResult.worker} exit=${result.workerResult.exitCode}`]),
    ...(result.workerResult !== undefined &&
    isCodexDirectWorkerResult(result.workerResult)
      ? [
          `Provider: ${result.workerResult.modelProvider}`,
          `Model: ${result.workerResult.model}`
        ]
      : []),
    ...(result.diffScope === undefined
      ? []
      : [`Diff scope: ${result.diffScope.passed ? "passed" : "failed"}`]),
    ...(result.verifierResult === undefined
      ? []
      : [`Verifier task: ${result.verifierResult.task.status}`]),
    result.pullRequest === undefined
      ? `Pull request: ${result.approval === undefined ? "not created" : `waiting approval ${result.approval.id}`}`
      : `Pull request: ${result.pullRequest.url ?? result.pullRequest.head}`
  ].join("\n");
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

export interface CiRepairPullRequestAuditSummary {
  toolCalls: CiRepairPullRequestToolPolicy[];
}

interface CiRepairPullRequestToolPolicy {
  actionType: string;
  status: string;
  decision?: string;
  risk?: string;
  ruleId?: string;
}

export function readCiRepairPullRequestAuditSummary(
  database: RunsteadDatabase,
  taskId: string
): CiRepairPullRequestAuditSummary {
  const rows = database
    .prepare(
      `
      SELECT
        tc.action_type,
        tc.status,
        pd.decision,
        pd.risk,
        pd.rule_id
      FROM tool_calls tc
      LEFT JOIN policy_decisions pd ON pd.id = tc.policy_decision_id
      WHERE tc.task_id = ?
        AND tc.status != 'requested'
      ORDER BY tc.started_at ASC, tc.id ASC
      LIMIT 16
    `
    )
    .all(taskId) as unknown as ToolPolicyRow[];

  return {
    toolCalls: rows.map((row) => ({
      actionType: row.action_type,
      status: row.status,
      ...(row.decision === null ? {} : { decision: row.decision }),
      ...(row.risk === null ? {} : { risk: row.risk }),
      ...(row.rule_id === null ? {} : { ruleId: row.rule_id })
    }))
  };
}

interface ToolPolicyRow {
  action_type: string;
  status: string;
  decision: string | null;
  risk: string | null;
  rule_id: string | null;
}

interface CiRepairPullRequestBodyContext extends JsonObject {
  verifierCommandResults: RunTaskVerifiersResult["commandResults"];
  workerResult: CiRepairWorkerResult;
  commit?: CommitGitChangesResult;
  diffScope: GitDiffScopeVerification;
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

function formatPullRequestToolPolicyLine(item: CiRepairPullRequestToolPolicy): string {
  return [
    `- ${item.actionType}: ${item.status}`,
    item.decision === undefined ? undefined : `policy=${item.decision}`,
    item.risk === undefined ? undefined : `risk=${item.risk}`,
    item.ruleId === undefined ? undefined : `rule=${item.ruleId}`
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
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

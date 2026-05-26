import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createRunsteadId,
  type Evidence,
  type RunsteadEvent,
  type Task
} from "@runstead/core";

import type { CiFailureClassification } from "./ci-repair-classification.js";
import type {
  GitHubWorkflowRunLog,
  GitHubWorkflowRunStatus
} from "./github-actions.js";

export const CI_LOG_EVIDENCE_METADATA = {
  trust: "untrusted_external",
  source: "github_actions_log",
  redacted: true,
  used_for_prompt: false
};

export async function writeCiRepairWorkflowRunEvidence(input: {
  runsteadRoot: string;
  task: Task;
  workflowRun: GitHubWorkflowRunStatus;
  failureClassification: CiFailureClassification;
  log: GitHubWorkflowRunLog;
  createdAt: string;
}): Promise<{
  evidence: Evidence;
  evidencePath: string;
  event: RunsteadEvent;
}> {
  const evidenceArtifact = {
    schemaVersion: 1,
    createdAt: input.createdAt,
    taskId: input.task.id,
    goalId: input.task.goalId,
    metadata: CI_LOG_EVIDENCE_METADATA,
    workflowRun: input.workflowRun,
    failureClassification: input.failureClassification,
    log: input.log
  };
  const evidenceContents = `${JSON.stringify(evidenceArtifact, null, 2)}\n`;
  const evidenceId = createRunsteadId("ev");
  const evidenceDir = join(input.runsteadRoot, "evidence");
  const evidencePath = join(
    evidenceDir,
    `github-workflow-run-${input.workflowRun.runId}-${evidenceId}.json`
  );
  const evidence: Evidence = {
    id: evidenceId,
    type: "github_workflow_run",
    subjectType: "task",
    subjectId: input.task.id,
    uri: pathToFileURL(evidencePath).href,
    hash: sha256(evidenceContents),
    summary: workflowRunSummary(input.workflowRun, input.log),
    createdAt: input.createdAt
  };
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "evidence.recorded",
    aggregateType: "evidence",
    aggregateId: evidence.id,
    payload: {
      evidenceId: evidence.id,
      evidenceType: evidence.type,
      taskId: input.task.id,
      uri: evidence.uri,
      hash: evidence.hash,
      summary: evidence.summary,
      metadata: CI_LOG_EVIDENCE_METADATA
    },
    createdAt: input.createdAt
  };

  await mkdir(evidenceDir, { recursive: true });
  await writeFile(evidencePath, evidenceContents, "utf8");

  return {
    evidence,
    evidencePath,
    event
  };
}

function workflowRunSummary(
  status: GitHubWorkflowRunStatus,
  log: GitHubWorkflowRunLog
): string {
  return [
    status.workflowName ?? "GitHub workflow",
    status.conclusion ?? status.status,
    `run ${status.runId}`,
    `${log.byteLength} log bytes`
  ].join(" ");
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  EvidenceSchema,
  RunsteadEventSchema,
  type Evidence,
  type JsonObject,
  type RunsteadEvent,
  type Task
} from "@runstead/core";
import { openRunsteadDatabase } from "@runstead/state-sqlite";

import type { CreateCiRepairTaskResult } from "./ci-repair.js";
import type {
  GitHubWorkflowRunLog,
  GitHubWorkflowRunStatus
} from "./github-actions.js";
import { listTasks } from "./tasks.js";

export function findExistingCiRepairTaskForWorkflowRun(input: {
  cwd: string;
  runId: string;
}): Task | undefined {
  return listTasks({ cwd: input.cwd }).tasks.find(
    (task) =>
      task.domain === "repo-maintenance" &&
      task.type === "ci_repair" &&
      String(task.input.runId) === input.runId
  );
}

export async function loadExistingCiRepairTaskResult(input: {
  cwd: string;
  stateDb: string;
  task: Task;
}): Promise<CreateCiRepairTaskResult | undefined> {
  const database = openRunsteadDatabase(input.stateDb);

  try {
    const evidenceRow = database
      .prepare(
        `
        SELECT id, type, subject_type, subject_id, uri, hash, summary, created_at
        FROM evidence
        WHERE subject_type = 'task' AND subject_id = ? AND type = 'github_workflow_run'
        ORDER BY created_at DESC, id ASC
        LIMIT 1
      `
      )
      .get(input.task.id) as EvidenceRow | undefined;
    const eventRow = database
      .prepare(
        `
        SELECT event_id, type, aggregate_type, aggregate_id, payload_json, created_at
        FROM events
        WHERE aggregate_type = 'task' AND aggregate_id = ? AND type = 'task.created'
        ORDER BY id ASC
        LIMIT 1
      `
      )
      .get(input.task.id) as EventRow | undefined;

    if (evidenceRow === undefined || eventRow === undefined) {
      return undefined;
    }

    const evidence = rowToEvidence(evidenceRow);
    const evidencePath = evidencePathFromUri(evidence.uri);

    if (evidencePath === undefined) {
      return undefined;
    }

    const artifact = JSON.parse(await readFile(evidencePath, "utf8")) as {
      workflowRun?: unknown;
      log?: unknown;
    };

    if (!isRecord(artifact.workflowRun) || !isRecord(artifact.log)) {
      return undefined;
    }

    return {
      status: "created",
      cwd: input.cwd,
      stateDb: input.stateDb,
      task: input.task,
      event: rowToRunsteadEvent(eventRow),
      evidence,
      evidencePath,
      workflowRun: artifact.workflowRun as unknown as GitHubWorkflowRunStatus,
      log: artifact.log as unknown as GitHubWorkflowRunLog,
      created: false
    };
  } finally {
    database.close();
  }
}

export function canRetryPartialCiRepairTask(task: Task): boolean {
  return task.status === "failed" || task.status === "cancelled";
}

interface EvidenceRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  uri: string;
  hash: string | null;
  summary: string | null;
  created_at: string;
}

interface EventRow {
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}

function rowToEvidence(row: EvidenceRow): Evidence {
  return EvidenceSchema.parse({
    id: row.id,
    type: row.type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    uri: row.uri,
    ...(row.hash === null ? {} : { hash: row.hash }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    createdAt: row.created_at
  });
}

function rowToRunsteadEvent(row: EventRow): RunsteadEvent {
  return RunsteadEventSchema.parse({
    eventId: row.event_id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: JSON.parse(row.payload_json) as JsonObject,
    createdAt: row.created_at
  });
}

function evidencePathFromUri(uri: string): string | undefined {
  try {
    const url = new URL(uri);

    return url.protocol === "file:" ? fileURLToPath(url) : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

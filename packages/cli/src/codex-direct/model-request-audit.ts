import { createRunsteadId, type Task, type WorkerRun } from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import { EXECUTION_LEASE_MS } from "./constants.js";
import type { CodexDirectModelRequestPhase } from "./worker-types.js";

export function recordModelRequestHeartbeat(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  sequence: number;
  stage: "started" | "waiting";
  phase: CodexDirectModelRequestPhase;
  elapsedMs: number;
  timeoutMs: number;
}): void {
  const heartbeatAt = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + EXECUTION_LEASE_MS).toISOString();

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "worker_run.heartbeat",
      aggregateType: "worker_run",
      aggregateId: input.workerRun.id,
      payload: {
        workerRunId: input.workerRun.id,
        taskId: input.task.id,
        phase: "model_inference_request",
        requestPhase: input.phase,
        stage: input.stage,
        sequence: input.sequence,
        elapsedMs: input.elapsedMs,
        timeoutMs: input.timeoutMs
      },
      createdAt: heartbeatAt
    }
  });
  input.database
    .prepare(
      `
      UPDATE worker_runs
      SET heartbeat_at = ?, lease_expires_at = ?
      WHERE id = ? AND status = 'running'
    `
    )
    .run(heartbeatAt, leaseExpiresAt, input.workerRun.id);
  input.database
    .prepare(
      `
      UPDATE tasks
      SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `
    )
    .run(heartbeatAt, leaseExpiresAt, heartbeatAt, input.task.id);
}

export function recordModelRequestRetry(input: {
  database: RunsteadDatabase;
  task: Task;
  workerRun: WorkerRun;
  phase: CodexDirectModelRequestPhase;
  attempt: number;
  nextAttempt: number;
  maxRetries: number;
  reason: string;
  delayMs: number;
  elapsedMs: number;
}): void {
  const createdAt = new Date().toISOString();

  appendEventAndProject(input.database, {
    event: {
      eventId: createRunsteadId("evt"),
      type: "model_request.retry",
      aggregateType: "worker_run",
      aggregateId: input.workerRun.id,
      payload: {
        workerRunId: input.workerRun.id,
        taskId: input.task.id,
        phase: input.phase,
        attempt: input.attempt,
        nextAttempt: input.nextAttempt,
        maxRetries: input.maxRetries,
        reason: input.reason,
        delayMs: input.delayMs,
        elapsedMs: input.elapsedMs
      },
      createdAt
    }
  });
}

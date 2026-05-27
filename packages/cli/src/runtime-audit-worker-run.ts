import {
  createRunsteadId,
  type JsonObject,
  type Task,
  type WorkerRun,
  type WorkerRunStatus
} from "@runstead/core";
import { appendEventAndProject, type RunsteadDatabase } from "@runstead/state-sqlite";

import { runtimeEvent } from "./runtime-audit-events.js";

export interface StartWorkerRunOptions {
  database: RunsteadDatabase;
  task: Task;
  workerType: string;
  enforcementLevel: string;
  checkpointBefore?: string;
  now?: Date;
}

export interface FinishWorkerRunOptions {
  database: RunsteadDatabase;
  workerRun: WorkerRun;
  status: Exclude<WorkerRunStatus, "running">;
  output?: JsonObject;
  now?: Date;
}

export function startWorkerRun(options: StartWorkerRunOptions): WorkerRun {
  const startedAt = (options.now ?? new Date()).toISOString();
  const workerRun: WorkerRun = {
    id: createRunsteadId("wrun"),
    taskId: options.task.id,
    workerType: options.workerType,
    status: "running",
    enforcementLevel: options.enforcementLevel,
    ...(options.checkpointBefore === undefined
      ? {}
      : { checkpointBefore: options.checkpointBefore }),
    startedAt
  };

  appendEventAndProject(options.database, {
    event: runtimeEvent(
      "worker_run.started",
      "worker_run",
      workerRun.id,
      {
        workerRunId: workerRun.id,
        taskId: workerRun.taskId,
        workerType: workerRun.workerType,
        enforcementLevel: workerRun.enforcementLevel,
        ...(workerRun.checkpointBefore === undefined
          ? {}
          : { checkpointBefore: workerRun.checkpointBefore })
      },
      startedAt
    ),
    projection: {
      type: "workerRun",
      value: workerRun
    }
  });

  return workerRun;
}

export function finishWorkerRun(options: FinishWorkerRunOptions): WorkerRun {
  const endedAt = (options.now ?? new Date()).toISOString();
  const workerRun: WorkerRun = {
    ...options.workerRun,
    status: options.status,
    endedAt,
    ...(options.output === undefined ? {} : { output: options.output })
  };

  appendEventAndProject(options.database, {
    event: runtimeEvent(
      `worker_run.${options.status}`,
      "worker_run",
      workerRun.id,
      {
        workerRunId: workerRun.id,
        taskId: workerRun.taskId,
        status: workerRun.status,
        ...(workerRun.output === undefined ? {} : { output: workerRun.output })
      },
      endedAt
    ),
    projection: {
      type: "workerRun",
      value: workerRun
    }
  });

  return workerRun;
}

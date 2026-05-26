import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import type { RunOnceResult } from "./run.js";
import type { ScheduleDueTasksResult } from "./scheduler.js";
import { requireRunsteadRoot, requireRunsteadStateDbSync } from "./runstead-root.js";
import type { DaemonHeartbeatStatus } from "./daemon-types.js";

export async function readDaemonStatus(
  options: {
    cwd?: string;
    staleAfterMs?: number;
    now?: Date;
  } = {}
): Promise<DaemonHeartbeatStatus> {
  const path = await daemonStatusPath(resolve(options.cwd ?? process.cwd()));
  const status = JSON.parse(await readFile(path, "utf8")) as DaemonHeartbeatStatus;

  if (options.staleAfterMs === undefined) {
    return status;
  }

  if (!Number.isFinite(options.staleAfterMs) || options.staleAfterMs < 0) {
    throw new Error("Daemon staleAfterMs must be a non-negative number");
  }

  const ageMs = Math.max(
    0,
    (options.now ?? new Date()).getTime() - Date.parse(status.updatedAt)
  );

  return {
    ...status,
    ageMs,
    stale: ageMs > options.staleAfterMs
  };
}

export function recordDaemonTickEvent(input: {
  cwd: string;
  tick: number;
  scheduled?: ScheduleDueTasksResult;
  result: RunOnceResult;
  now?: Date;
}): RunsteadEvent {
  const stateDb = requireRunsteadStateDbSync(input.cwd).stateDb;
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: "daemon.tick",
    aggregateType: "daemon",
    aggregateId: input.cwd,
    payload: daemonTickPayload(input),
    createdAt: (input.now ?? new Date()).toISOString()
  };
  const database = openRunsteadDatabase(stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }

  return event;
}

export async function writeDaemonHeartbeat(input: {
  cwd: string;
  tick: number;
  intervalMs: number;
  scheduled?: ScheduleDueTasksResult;
  result: RunOnceResult;
  event?: RunsteadEvent;
  now?: Date;
}): Promise<DaemonHeartbeatStatus> {
  const status = daemonHeartbeatStatus(input);
  const path = await daemonStatusPath(input.cwd);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(status, null, 2)}\n`, "utf8");

  return status;
}

function daemonTickPayload(input: {
  tick: number;
  scheduled?: ScheduleDueTasksResult;
  result: RunOnceResult;
}): JsonObject {
  if (!input.result.ranTask) {
    return {
      tick: input.tick,
      scheduledTasks: input.scheduled?.scheduledTasks.length ?? 0,
      skippedTasks: input.scheduled?.skippedTasks.length ?? 0,
      ranTask: false,
      reason: input.result.reason
    };
  }

  return {
    tick: input.tick,
    scheduledTasks: input.scheduled?.scheduledTasks.length ?? 0,
    skippedTasks: input.scheduled?.skippedTasks.length ?? 0,
    ranTask: true,
    taskId: input.result.task.id,
    taskType: input.result.task.type,
    taskStatus: input.result.task.status,
    ...(input.result.ciRepairResult === undefined
      ? {}
      : {
          ciRepairStatus: input.result.ciRepairResult.status,
          branchName: input.result.ciRepairResult.branchName,
          ...(input.result.ciRepairResult.approval === undefined
            ? {}
            : { approvalId: input.result.ciRepairResult.approval.id }),
          ...(input.result.ciRepairResult.pullRequest === undefined
            ? {}
            : {
                pullRequest:
                  input.result.ciRepairResult.pullRequest.url ??
                  input.result.ciRepairResult.pullRequest.head
              })
        })
  };
}

function daemonHeartbeatStatus(input: {
  cwd: string;
  tick: number;
  intervalMs: number;
  scheduled?: ScheduleDueTasksResult;
  result: RunOnceResult;
  event?: RunsteadEvent;
  now?: Date;
}): DaemonHeartbeatStatus {
  const base = {
    cwd: input.cwd,
    pid: process.pid,
    tick: input.tick,
    intervalMs: input.intervalMs,
    updatedAt: (input.now ?? new Date()).toISOString(),
    scheduledTasks: input.scheduled?.scheduledTasks.length ?? 0,
    skippedTasks: input.scheduled?.skippedTasks.length ?? 0,
    ...(input.event === undefined ? {} : { eventId: input.event.eventId })
  };

  if (!input.result.ranTask) {
    return {
      ...base,
      ranTask: false,
      reason: input.result.reason
    };
  }

  return {
    ...base,
    ranTask: true,
    taskId: input.result.task.id,
    taskType: input.result.task.type,
    taskStatus: input.result.task.status,
    ...(input.result.ciRepairResult === undefined
      ? {}
      : {
          ciRepairStatus: input.result.ciRepairResult.status,
          branchName: input.result.ciRepairResult.branchName,
          ...(input.result.ciRepairResult.approval === undefined
            ? {}
            : { approvalId: input.result.ciRepairResult.approval.id }),
          ...(input.result.ciRepairResult.pullRequest === undefined
            ? {}
            : {
                pullRequest:
                  input.result.ciRepairResult.pullRequest.url ??
                  input.result.ciRepairResult.pullRequest.head
              })
        })
  };
}

async function daemonStatusPath(cwd: string): Promise<string> {
  const resolved = await requireRunsteadRoot(cwd);
  return join(resolved.root, "daemon", "status.json");
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  createRunsteadId,
  type JsonObject,
  type ManagerLock,
  type RunsteadEvent
} from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import {
  runOnce,
  runOnceUnlocked,
  type RunOnceOptions,
  type RunOnceResult
} from "./run.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import {
  scheduleDueTasks,
  scheduleDueTasksUnlocked,
  type ScheduleDueTasksOptions,
  type ScheduleDueTasksResult
} from "./scheduler.js";
import { requireRunsteadRoot, requireRunsteadStateDbSync } from "./runstead-root.js";

export interface RunDaemonOptions {
  cwd?: string;
  intervalMs?: number;
  maxTicks?: number;
  runner?: DaemonRunner;
  scheduler?: DaemonScheduler;
  schedulerEnabled?: boolean;
  audit?: boolean;
  heartbeat?: boolean;
  managerLock?: Pick<ManagerLock, "heartbeat">;
  now?: Date;
}

export type DaemonRunner = (options: RunOnceOptions) => Promise<RunOnceResult>;
export type DaemonScheduler = (
  options: ScheduleDueTasksOptions
) => Promise<ScheduleDueTasksResult>;

export interface DaemonTick {
  tick: number;
  scheduled?: ScheduleDueTasksResult;
  result: RunOnceResult;
  event?: RunsteadEvent;
  heartbeat?: DaemonHeartbeatStatus;
}

export interface RunDaemonResult {
  cwd: string;
  intervalMs: number;
  ticks: DaemonTick[];
  stoppedReason: "max_ticks";
}

export interface DaemonHeartbeatStatus {
  cwd: string;
  pid: number;
  tick: number;
  intervalMs: number;
  updatedAt: string;
  scheduledTasks: number;
  skippedTasks: number;
  ranTask: boolean;
  reason?: string;
  taskId?: string;
  taskType?: string;
  taskStatus?: string;
  ciRepairStatus?: string;
  branchName?: string;
  approvalId?: string;
  pullRequest?: string;
  eventId?: string;
  ageMs?: number;
  stale?: boolean;
}

export async function runDaemon(
  options: RunDaemonOptions = {}
): Promise<RunDaemonResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const intervalMs = options.intervalMs ?? 30_000;
  const maxTicks = options.maxTicks;
  const usesDefaultRuntime =
    options.runner === undefined && options.scheduler === undefined;

  assertDaemonTiming({ intervalMs, maxTicks });

  if (usesDefaultRuntime) {
    return withRunsteadManagerLock({ cwd }, async (managerLock) =>
      runDaemonLoop({
        ...options,
        cwd,
        audit: options.audit ?? true,
        heartbeat: options.heartbeat ?? true,
        managerLock,
        scheduler: (schedulerOptions) =>
          scheduleDueTasksUnlocked({
            ...schedulerOptions,
            cwd
          }),
        runner: (runnerOptions) => runOnceUnlocked(cwd, { ...runnerOptions, cwd })
      })
    );
  }

  return runDaemonLoop({
    ...options,
    cwd
  });
}

async function runDaemonLoop(options: RunDaemonOptions): Promise<RunDaemonResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const intervalMs = options.intervalMs ?? 30_000;
  const maxTicks = options.maxTicks;
  const runner = options.runner ?? runOnce;
  const scheduler = options.scheduler ?? scheduleDueTasks;
  const ticks: DaemonTick[] = [];

  assertDaemonTiming({ intervalMs, maxTicks });

  while (maxTicks === undefined || ticks.length < maxTicks) {
    const scheduled =
      options.schedulerEnabled === false ? undefined : await scheduler({ cwd });
    const result = await runner({ cwd });
    const tickNumber = ticks.length + 1;
    const event =
      options.audit === true
        ? recordDaemonTickEvent({
            cwd,
            tick: tickNumber,
            result,
            ...(scheduled === undefined ? {} : { scheduled }),
            ...(options.now === undefined ? {} : { now: options.now })
          })
        : undefined;
    const heartbeat =
      options.heartbeat === true
        ? await writeDaemonHeartbeat({
            cwd,
            tick: tickNumber,
            intervalMs,
            result,
            ...(scheduled === undefined ? {} : { scheduled }),
            ...(event === undefined ? {} : { event }),
            ...(options.now === undefined ? {} : { now: options.now })
          })
        : undefined;

    ticks.push({
      tick: tickNumber,
      ...(scheduled === undefined ? {} : { scheduled }),
      result,
      ...(event === undefined ? {} : { event }),
      ...(heartbeat === undefined ? {} : { heartbeat })
    });
    await options.managerLock?.heartbeat();

    if (maxTicks !== undefined && ticks.length >= maxTicks) {
      return {
        cwd,
        intervalMs,
        ticks,
        stoppedReason: "max_ticks"
      };
    }

    await sleep(intervalMs);
  }

  return {
    cwd,
    intervalMs,
    ticks,
    stoppedReason: "max_ticks"
  };
}

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

export function formatDaemonStatus(status: DaemonHeartbeatStatus): string {
  return [
    "Runstead daemon status",
    `Cwd: ${status.cwd}`,
    `Updated: ${status.updatedAt}`,
    `Pid: ${status.pid}`,
    `Tick: ${status.tick}`,
    `Interval: ${status.intervalMs}ms`,
    ...(status.stale === undefined
      ? []
      : [
          `Health: ${status.stale ? "stale" : "healthy"}${
            status.ageMs === undefined ? "" : ` age=${status.ageMs}ms`
          }`
        ]),
    `Scheduled: ${status.scheduledTasks}`,
    `Skipped: ${status.skippedTasks}`,
    status.ranTask
      ? `Last result: ran ${status.taskId ?? "unknown"} type=${status.taskType ?? "unknown"} status=${status.taskStatus ?? "unknown"}`
      : `Last result: idle (${status.reason ?? "unknown"})`,
    ...(status.ciRepairStatus === undefined
      ? []
      : [
          [
            `CI repair: ${status.ciRepairStatus}`,
            status.branchName === undefined ? undefined : `branch=${status.branchName}`,
            status.pullRequest === undefined ? undefined : `pr=${status.pullRequest}`,
            status.approvalId === undefined
              ? undefined
              : `approval=${status.approvalId}`
          ]
            .filter((part): part is string => part !== undefined)
            .join(" ")
        ]),
    ...(status.eventId === undefined ? [] : [`Audit event: ${status.eventId}`])
  ].join("\n");
}

function assertDaemonTiming(input: {
  intervalMs: number;
  maxTicks: number | undefined;
}): void {
  if (input.intervalMs < 0 || !Number.isFinite(input.intervalMs)) {
    throw new Error("Daemon interval must be a non-negative number");
  }

  if (
    input.maxTicks !== undefined &&
    (!Number.isInteger(input.maxTicks) || input.maxTicks <= 0)
  ) {
    throw new Error("Daemon maxTicks must be a positive integer");
  }
}

function recordDaemonTickEvent(input: {
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

export function formatDaemonReport(result: RunDaemonResult): string {
  return [
    "Runstead daemon",
    `Cwd: ${result.cwd}`,
    `Ticks: ${result.ticks.length}`,
    `Stopped: ${result.stoppedReason}`,
    ...result.ticks.map(formatDaemonTick)
  ].join("\n");
}

function formatDaemonTick(tick: DaemonTick): string {
  if (!tick.result.ranTask) {
    return `  tick ${tick.tick}: scheduled=${scheduledCount(tick)} idle (${tick.result.reason})`;
  }

  const base = `  tick ${tick.tick}: scheduled=${scheduledCount(tick)} ran ${tick.result.task.id} type=${tick.result.task.type} status=${tick.result.task.status}`;

  if (tick.result.ciRepairResult === undefined) {
    return base;
  }

  const ciRepair = tick.result.ciRepairResult;
  const pullRequest =
    ciRepair.pullRequest === undefined
      ? []
      : [`pr=${ciRepair.pullRequest.url ?? ciRepair.pullRequest.head}`];
  const approval =
    ciRepair.approval === undefined ? [] : [`approval=${ciRepair.approval.id}`];

  return [
    base,
    `ci_repair=${ciRepair.status}`,
    `branch=${ciRepair.branchName}`,
    ...pullRequest,
    ...approval
  ].join(" ");
}

function scheduledCount(tick: DaemonTick): number {
  return tick.scheduled?.scheduledTasks.length ?? 0;
}

async function writeDaemonHeartbeat(input: {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

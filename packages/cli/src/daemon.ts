import { resolve } from "node:path";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
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
import { requireRunsteadStateDbSync } from "./runstead-root.js";

export interface RunDaemonOptions {
  cwd?: string;
  intervalMs?: number;
  maxTicks?: number;
  runner?: DaemonRunner;
  scheduler?: DaemonScheduler;
  schedulerEnabled?: boolean;
  audit?: boolean;
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
}

export interface RunDaemonResult {
  cwd: string;
  intervalMs: number;
  ticks: DaemonTick[];
  stoppedReason: "max_ticks";
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
    return withRunsteadManagerLock({ cwd }, async () =>
      runDaemonLoop({
        ...options,
        cwd,
        audit: options.audit ?? true,
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

    ticks.push({
      tick: tickNumber,
      ...(scheduled === undefined ? {} : { scheduled }),
      result,
      ...(event === undefined ? {} : { event })
    });

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

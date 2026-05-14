import { resolve } from "node:path";

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

export interface RunDaemonOptions {
  cwd?: string;
  intervalMs?: number;
  maxTicks?: number;
  runner?: DaemonRunner;
  scheduler?: DaemonScheduler;
  schedulerEnabled?: boolean;
}

export type DaemonRunner = (options: RunOnceOptions) => Promise<RunOnceResult>;
export type DaemonScheduler = (
  options: ScheduleDueTasksOptions
) => Promise<ScheduleDueTasksResult>;

export interface DaemonTick {
  tick: number;
  scheduled?: ScheduleDueTasksResult;
  result: RunOnceResult;
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

    ticks.push({
      tick: ticks.length + 1,
      ...(scheduled === undefined ? {} : { scheduled }),
      result
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

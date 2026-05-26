import { resolve } from "node:path";

import { runOnce, runOnceUnlocked } from "./run.js";
import { withRunsteadManagerLock } from "./manager-lock.js";
import { scheduleDueTasks, scheduleDueTasksUnlocked } from "./scheduler.js";
import type { DaemonTick, RunDaemonOptions, RunDaemonResult } from "./daemon-types.js";
import { recordDaemonTickEvent, writeDaemonHeartbeat } from "./daemon-state.js";

export { formatDaemonReport, formatDaemonStatus } from "./daemon-format.js";
export { readDaemonStatus } from "./daemon-state.js";
export type {
  DaemonHeartbeatStatus,
  DaemonRunner,
  DaemonScheduler,
  DaemonTick,
  RunDaemonOptions,
  RunDaemonResult
} from "./daemon-types.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

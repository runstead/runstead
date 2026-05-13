import { resolve } from "node:path";

import { runOnce, type RunOnceOptions, type RunOnceResult } from "./run.js";

export interface RunDaemonOptions {
  cwd?: string;
  intervalMs?: number;
  maxTicks?: number;
  runner?: DaemonRunner;
}

export type DaemonRunner = (options: RunOnceOptions) => Promise<RunOnceResult>;

export interface DaemonTick {
  tick: number;
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
  const runner = options.runner ?? runOnce;
  const ticks: DaemonTick[] = [];

  if (intervalMs < 0 || !Number.isFinite(intervalMs)) {
    throw new Error("Daemon interval must be a non-negative number");
  }

  if (maxTicks !== undefined && (!Number.isInteger(maxTicks) || maxTicks <= 0)) {
    throw new Error("Daemon maxTicks must be a positive integer");
  }

  while (maxTicks === undefined || ticks.length < maxTicks) {
    const result = await runner({ cwd });

    ticks.push({
      tick: ticks.length + 1,
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

export function formatDaemonReport(result: RunDaemonResult): string {
  return [
    "Runstead daemon",
    `Cwd: ${result.cwd}`,
    `Ticks: ${result.ticks.length}`,
    `Stopped: ${result.stoppedReason}`,
    ...result.ticks.map((tick) =>
      tick.result.ranTask
        ? `  tick ${tick.tick}: ran ${tick.result.task.id} status=${tick.result.task.status}`
        : `  tick ${tick.tick}: idle (${tick.result.reason})`
    )
  ].join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

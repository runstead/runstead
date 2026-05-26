import type { ManagerLock, RunsteadEvent } from "@runstead/core";

import type { RunOnceOptions, RunOnceResult } from "./run.js";
import type { ScheduleDueTasksOptions, ScheduleDueTasksResult } from "./scheduler.js";

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

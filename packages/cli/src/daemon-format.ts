import type {
  DaemonHeartbeatStatus,
  DaemonTick,
  RunDaemonResult
} from "./daemon-types.js";

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

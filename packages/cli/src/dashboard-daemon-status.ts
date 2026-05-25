import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DashboardDaemonStatus } from "./dashboard-types.js";

export async function readDashboardDaemonStatus(
  root: string,
  generatedAt: string
): Promise<DashboardDaemonStatus> {
  try {
    const raw = JSON.parse(
      await readFile(join(root, "daemon", "status.json"), "utf8")
    ) as Record<string, unknown>;
    const health = daemonHealth(raw, generatedAt);

    return {
      available: true,
      ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
      ...(typeof raw.pid === "number" ? { pid: raw.pid } : {}),
      ...(typeof raw.tick === "number" ? { tick: raw.tick } : {}),
      ...(typeof raw.intervalMs === "number" ? { intervalMs: raw.intervalMs } : {}),
      ...(typeof raw.ranTask === "boolean" ? { ranTask: raw.ranTask } : {}),
      ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
      ...(typeof raw.taskId === "string" ? { taskId: raw.taskId } : {}),
      ...(typeof raw.taskType === "string" ? { taskType: raw.taskType } : {}),
      ...(typeof raw.taskStatus === "string" ? { taskStatus: raw.taskStatus } : {}),
      ...(typeof raw.ciRepairStatus === "string"
        ? { ciRepairStatus: raw.ciRepairStatus }
        : {}),
      ...(typeof raw.branchName === "string" ? { branchName: raw.branchName } : {}),
      ...(typeof raw.approvalId === "string" ? { approvalId: raw.approvalId } : {}),
      ...(typeof raw.pullRequest === "string" ? { pullRequest: raw.pullRequest } : {}),
      ...(typeof raw.eventId === "string" ? { eventId: raw.eventId } : {}),
      ...(health ?? {})
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof SyntaxError ? "invalid_status" : "missing_status"
    };
  }
}

function daemonHealth(
  raw: Record<string, unknown>,
  generatedAt: string
): Pick<DashboardDaemonStatus, "ageMs" | "stale"> | undefined {
  if (typeof raw.updatedAt !== "string" || typeof raw.intervalMs !== "number") {
    return undefined;
  }

  const generatedMs = Date.parse(generatedAt);
  const updatedMs = Date.parse(raw.updatedAt);

  if (!Number.isFinite(generatedMs) || !Number.isFinite(updatedMs)) {
    return undefined;
  }

  const ageMs = Math.max(0, generatedMs - updatedMs);

  return {
    ageMs,
    stale: ageMs > raw.intervalMs * 2
  };
}

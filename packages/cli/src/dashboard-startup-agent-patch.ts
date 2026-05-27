import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type { DashboardStartupAgentPatch } from "./dashboard-types.js";

export function latestStartupAgentPatch(database: RunsteadDatabase): {
  agentPatch?: DashboardStartupAgentPatch;
} {
  const row = database
    .prepare(
      `
      SELECT worker_run_id, task_id, status, output_json, started_at, ended_at
      FROM tool_calls
      WHERE action_type = 'filesystem.patch'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
      `
    )
    .get() as
    | {
        worker_run_id: string;
        task_id: string;
        status: string;
        output_json: string | null;
        started_at: string;
        ended_at: string | null;
      }
    | undefined;

  if (row === undefined) {
    return {};
  }

  const output = parseJsonRecord(row.output_json);
  const filesTouched = stringArrayField(output?.filesTouched).slice(0, 20);

  return {
    agentPatch: {
      taskId: row.task_id,
      workerRunId: row.worker_run_id,
      status: row.status,
      startedAt: row.started_at,
      ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
      filesTouched,
      summary:
        filesTouched.length === 0
          ? "filesystem.patch audited; touched files were not reported"
          : `filesystem.patch touched ${filesTouched.length} file${filesTouched.length === 1 ? "" : "s"}`
    }
  };
}

function parseJsonRecord(
  value: string | null | undefined
): Record<string, unknown> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

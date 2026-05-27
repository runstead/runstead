import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type {
  DashboardStartupAgentPatch,
  DashboardStartupRunComparison,
  DashboardStartupRun,
  DashboardStartupTimelineGroup
} from "./dashboard-types.js";
import {
  dashboardApprovalTimelineGroup,
  dashboardEvidenceTimelineGroup,
  dashboardModelRequestTimelineGroup,
  dashboardToolCallTimelineGroup,
  dashboardWorkerRunTimelineGroup
} from "./dashboard-audit-timeline.js";

export { dashboardStartupRunComparison } from "./dashboard-startup-run-comparison.js";

export function dashboardStartupTimelineGroups(input: {
  database: RunsteadDatabase;
  latestRun?: DashboardStartupRun;
  runComparison?: DashboardStartupRunComparison;
  latestReportPath?: string;
}): DashboardStartupTimelineGroup[] {
  return [
    dashboardRecoveryTimelineGroup(input.runComparison),
    dashboardPhaseTimelineGroup(input.latestRun),
    dashboardWorkerRunTimelineGroup(input.database),
    dashboardModelRequestTimelineGroup(input.database),
    dashboardToolCallTimelineGroup(input.database),
    dashboardApprovalTimelineGroup(input.database),
    dashboardEvidenceTimelineGroup(input.database),
    dashboardReportTimelineGroup(input.latestRun, input.latestReportPath)
  ].filter((group): group is DashboardStartupTimelineGroup => group.items.length > 0);
}

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

function dashboardRecoveryTimelineGroup(
  comparison: DashboardStartupRunComparison | undefined
): DashboardStartupTimelineGroup {
  return {
    group: "recovery",
    title: "Recovery Decisions",
    items:
      comparison?.resolvedBlockerDetails.map((detail, index) => ({
        id: `resolved-blocker-${index + 1}`,
        title: detail.blocker,
        status: "resolved",
        detail: `${detail.resolution} evidence=${detail.evidenceIds.join(", ") || "none"}`,
        artifacts: detail.artifacts
      })) ?? []
  };
}

function dashboardPhaseTimelineGroup(
  run: DashboardStartupRun | undefined
): DashboardStartupTimelineGroup {
  return {
    group: "phases",
    title: "Phases",
    items:
      run?.timeline.map((item) => {
        const topDetail = item.blockers[0] ?? item.nextAction;
        const evidenceDetail =
          item.evidenceIds.length === 0
            ? undefined
            : `evidence=${item.evidenceIds.join(", ")}`;
        const detail = [topDetail, evidenceDetail]
          .filter((part): part is string => part !== undefined)
          .join("; ");

        return {
          id: item.phase,
          title: item.title,
          status: item.status,
          ...(detail.length === 0 ? {} : { detail }),
          artifacts: item.artifacts
        };
      }) ?? []
  };
}

function dashboardReportTimelineGroup(
  run: DashboardStartupRun | undefined,
  latestReportPath: string | undefined
): DashboardStartupTimelineGroup {
  const reports = [
    ...(run?.reports ?? []),
    ...(latestReportPath === undefined ? [] : [latestReportPath])
  ];
  const uniqueReports = [...new Set(reports)];

  return {
    group: "reports",
    title: "Reports",
    items: uniqueReports.map((path, index) => ({
      id: `report-${index + 1}`,
      title: path.split("/").pop() ?? path,
      status: "available",
      detail: path,
      artifacts: [path]
    }))
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

import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type {
  DashboardStartupRunComparison,
  DashboardStartupRun,
  DashboardStartupTimelineGroup
} from "./dashboard-types.js";
import {
  dashboardToolCallTimelineGroup,
  dashboardWorkerRunTimelineGroup
} from "./dashboard-execution-timeline.js";
import {
  dashboardApprovalTimelineGroup,
  dashboardEvidenceTimelineGroup
} from "./dashboard-governance-evidence-timeline.js";
import { dashboardModelRequestTimelineGroup } from "./dashboard-model-request-timeline.js";

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

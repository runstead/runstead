import { join } from "node:path";

import type { RunsteadDatabase } from "@runstead/state-sqlite";

import { readStartupRuns } from "./dashboard-startup-runs.js";
import {
  dashboardStartupRunComparison,
  dashboardStartupTimelineGroups,
  latestStartupAgentPatch
} from "./dashboard-startup-timeline.js";
import type { DashboardStartupSnapshot } from "./dashboard-types.js";
import { getStartupStatus } from "./startup-status.js";

export async function readDashboardStartupStatus(input: {
  cwd: string;
  root: string;
  generatedAt: string;
  database: RunsteadDatabase;
}): Promise<DashboardStartupSnapshot> {
  try {
    const runs = await readStartupRuns(input.root);
    const latestRun = runs[0];
    const report = latestStartupReport(input.root);
    const status = await getStartupStatus({
      cwd: input.cwd,
      now: new Date(input.generatedAt)
    });
    const runComparison = dashboardStartupRunComparison(runs);

    return {
      available: true,
      status,
      ...report,
      ...(latestRun === undefined ? {} : { latestRun }),
      ...runComparison,
      timelineGroups: dashboardStartupTimelineGroups({
        database: input.database,
        ...(latestRun === undefined ? {} : { latestRun }),
        ...(runComparison.runComparison === undefined
          ? {}
          : { runComparison: runComparison.runComparison }),
        ...(report.latestReportPath === undefined
          ? {}
          : { latestReportPath: report.latestReportPath })
      }),
      staleEvidence: status.evidence.staleSources.slice(0, 12).map((source) => ({
        evidenceId: source.evidenceId,
        type: source.type,
        uri: source.uri,
        ageDays: source.ageDays,
        freshnessDays: source.freshnessDays
      })),
      ...latestStartupAgentPatch(input.database)
    };
  } catch (error) {
    return {
      available: false,
      timelineGroups: [],
      staleEvidence: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function latestStartupReport(root: string): { latestReportPath?: string } {
  const reportPath = join(root, "reports", "launch-readiness-ai-native-startup.md");

  return { latestReportPath: reportPath };
}

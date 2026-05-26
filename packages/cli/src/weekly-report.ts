import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { readWeeklyReportData } from "./weekly-report-data.js";
import {
  formatWeeklyReport,
  summarizeWeeklyReport
} from "./weekly-report-format.js";
import type {
  GenerateWeeklyReportOptions,
  WeeklyReportData,
  WeeklyReportResult
} from "./weekly-report-types.js";
import {
  WEEKLY_REPORT_DAY_MS,
  formatIsoWeek,
  isoWeekFromDate,
  isoWeekStart,
  parseIsoWeekLabel
} from "./weekly-report-week.js";

export type {
  ApprovalReportRow,
  EvidenceReportRow,
  EventReportRow,
  GenerateWeeklyReportOptions,
  GoalReportRow,
  PolicyDecisionReportRow,
  TaskReportRow,
  WeeklyReportData,
  WeeklyReportResult
} from "./weekly-report-types.js";
export { readWeeklyReportData } from "./weekly-report-data.js";
export { formatWeeklyReport, summarizeWeeklyReport } from "./weekly-report-format.js";
export { isoWeekLabel } from "./weekly-report-week.js";

export async function generateWeeklyReport(
  options: GenerateWeeklyReportOptions = {}
): Promise<WeeklyReportResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = await requireRunsteadStateDb(cwd);

  const generatedAt = options.now ?? new Date();
  const isoWeek =
    options.week === undefined
      ? isoWeekFromDate(generatedAt)
      : parseIsoWeekLabel(options.week);
  const week = formatIsoWeek(isoWeek);
  const periodStartDate = isoWeekStart(isoWeek);
  const periodEndDate = new Date(periodStartDate.getTime() + WEEKLY_REPORT_DAY_MS * 7);
  const periodStart = periodStartDate.toISOString();
  const periodEnd = periodEndDate.toISOString();
  const stateDb = resolvedState.stateDb;
  const reportPath = join(resolvedState.root, "reports", `weekly-${week}.md`);
  const database = openRunsteadDatabase(stateDb);

  try {
    const data = readWeeklyReportData(database, periodStart, periodEnd);
    const markdown = formatWeeklyReport({
      week,
      generatedAt: generatedAt.toISOString(),
      periodStart,
      periodEnd,
      data
    });
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "report.generated",
      aggregateType: "report",
      aggregateId: `weekly_${week.replace("-", "_")}`,
      payload: reportEventPayload({
        week,
        periodStart,
        periodEnd,
        reportPath,
        markdown,
        data
      }),
      createdAt: generatedAt.toISOString()
    };

    await mkdir(join(resolvedState.root, "reports"), { recursive: true });
    await writeFile(reportPath, markdown, "utf8");
    appendEventAndProject(database, { event });

    return {
      root: resolvedState.root,
      stateDb,
      week,
      periodStart,
      periodEnd,
      reportPath,
      markdown,
      event
    };
  } finally {
    database.close();
  }
}

function reportEventPayload(input: {
  week: string;
  periodStart: string;
  periodEnd: string;
  reportPath: string;
  markdown: string;
  data: WeeklyReportData;
}): JsonObject {
  const summary = summarizeWeeklyReport(input.data);

  return {
    reportType: "weekly",
    week: input.week,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    uri: pathToFileURL(input.reportPath).href,
    hash: sha256(input.markdown),
    summary
  };
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

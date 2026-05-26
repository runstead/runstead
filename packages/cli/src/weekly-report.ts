import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import { appendEventAndProject, openRunsteadDatabase } from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import {
  WEEKLY_REPORT_DAY_MS,
  formatIsoWeek,
  isoWeekFromDate,
  isoWeekStart,
  parseIsoWeekLabel
} from "./weekly-report-week.js";

export { isoWeekLabel } from "./weekly-report-week.js";

export interface GenerateWeeklyReportOptions {
  cwd?: string;
  week?: string;
  now?: Date;
}

export interface WeeklyReportResult {
  root: string;
  stateDb: string;
  week: string;
  periodStart: string;
  periodEnd: string;
  reportPath: string;
  markdown: string;
  event: RunsteadEvent;
}

interface WeeklyReportData {
  goals: GoalReportRow[];
  tasks: TaskReportRow[];
  evidence: EvidenceReportRow[];
  policyDecisions: PolicyDecisionReportRow[];
  approvals: ApprovalReportRow[];
  events: EventReportRow[];
}

interface GoalReportRow {
  id: string;
  domain: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
}

interface TaskReportRow {
  id: string;
  goal_id: string;
  domain: string;
  type: string;
  status: string;
  priority: string;
  attempt: number;
  max_attempts: number;
  updated_at: string;
}

interface EvidenceReportRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  uri: string;
  summary: string | null;
  created_at: string;
}

interface PolicyDecisionReportRow {
  id: string;
  action_id: string;
  policy_id: string;
  decision: string;
  risk: string;
  rule_id: string | null;
  reason: string;
  created_at: string;
}

interface ApprovalReportRow {
  id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  created_at: string;
  updated_at: string;
}

interface EventReportRow {
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  created_at: string;
}

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

function readWeeklyReportData(
  database: ReturnType<typeof openRunsteadDatabase>,
  periodStart: string,
  periodEnd: string
): WeeklyReportData {
  const goals = database
    .prepare(
      `
      SELECT id, domain, title, status, priority, created_at, updated_at
      FROM goals
      ORDER BY status ASC, priority DESC, created_at DESC, id ASC
    `
    )
    .all() as unknown as GoalReportRow[];
  const tasks = database
    .prepare(
      `
      SELECT id, goal_id, domain, type, status, priority, attempt, max_attempts,
             updated_at
      FROM tasks
      WHERE (created_at >= ? AND created_at < ?)
         OR (updated_at >= ? AND updated_at < ?)
      ORDER BY updated_at DESC, id ASC
    `
    )
    .all(periodStart, periodEnd, periodStart, periodEnd) as unknown as TaskReportRow[];
  const evidence = database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, uri, summary, created_at
      FROM evidence
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id ASC
    `
    )
    .all(periodStart, periodEnd) as unknown as EvidenceReportRow[];
  const policyDecisions = database
    .prepare(
      `
      SELECT id, action_id, policy_id, decision, risk, rule_id, reason, created_at
      FROM policy_decisions
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id ASC
    `
    )
    .all(periodStart, periodEnd) as unknown as PolicyDecisionReportRow[];
  const approvals = database
    .prepare(
      `
      SELECT id, action_id, status, risk, reason, created_at, updated_at
      FROM approvals
      WHERE (created_at >= ? AND created_at < ?)
         OR (updated_at >= ? AND updated_at < ?)
      ORDER BY updated_at DESC, id ASC
    `
    )
    .all(
      periodStart,
      periodEnd,
      periodStart,
      periodEnd
    ) as unknown as ApprovalReportRow[];
  const events = database
    .prepare(
      `
      SELECT event_id, type, aggregate_type, aggregate_id, created_at
      FROM events
      WHERE created_at >= ? AND created_at < ?
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
    )
    .all(periodStart, periodEnd) as unknown as EventReportRow[];

  return {
    goals,
    tasks,
    evidence,
    policyDecisions,
    approvals,
    events
  };
}

function formatWeeklyReport(input: {
  week: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  data: WeeklyReportData;
}): string {
  const summary = summarizeWeeklyReport(input.data);

  return [
    "# Runstead Weekly Report",
    "",
    `Week: ${input.week}`,
    `Period: ${input.periodStart} to ${input.periodEnd}`,
    `Generated: ${input.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Active goals: ${summary.activeGoals}`,
    `- Tasks touched: ${summary.tasksTouched}`,
    `- Completed tasks: ${summary.completedTasks}`,
    `- Failed tasks: ${summary.failedTasks}`,
    `- Evidence recorded: ${summary.evidenceRecorded}`,
    `- Policy decisions: ${summary.policyDecisions}`,
    `- Pending approvals: ${summary.pendingApprovals}`,
    "",
    "## Goals",
    "",
    listOrNone(
      input.data.goals,
      (goal) => `- ${goal.status} ${goal.id}: ${goal.title} (${goal.domain})`
    ),
    "",
    "## Task Status",
    "",
    formatTaskStatusCounts(input.data.tasks),
    "",
    "## Task Activity",
    "",
    listOrNone(
      input.data.tasks,
      (task) =>
        `- ${task.status} ${task.id}: ${task.type} (${task.attempt}/${task.max_attempts}, goal ${task.goal_id})`
    ),
    "",
    "## Evidence",
    "",
    listOrNone(
      input.data.evidence,
      (evidence) =>
        `- ${evidence.id} ${evidence.type} for ${evidence.subject_type} ${evidence.subject_id}: ${evidence.summary ?? evidence.uri}`
    ),
    "",
    "## Policy Decisions",
    "",
    listOrNone(
      input.data.policyDecisions,
      (decision) =>
        `- ${decision.decision} ${decision.id}: ${decision.reason} (${decision.risk}, action ${decision.action_id})`
    ),
    "",
    "## Approvals",
    "",
    listOrNone(
      input.data.approvals,
      (approval) =>
        `- ${approval.status} ${approval.id}: ${approval.reason} (${approval.risk}, action ${approval.action_id})`
    ),
    "",
    "## Recent Events",
    "",
    listOrNone(
      input.data.events,
      (event) =>
        `- ${event.created_at} ${event.type} ${event.aggregate_type}/${event.aggregate_id}`
    ),
    ""
  ].join("\n");
}

function summarizeWeeklyReport(data: WeeklyReportData): {
  activeGoals: number;
  tasksTouched: number;
  completedTasks: number;
  failedTasks: number;
  evidenceRecorded: number;
  policyDecisions: number;
  pendingApprovals: number;
} {
  return {
    activeGoals: data.goals.filter((goal) => goal.status === "active").length,
    tasksTouched: data.tasks.length,
    completedTasks: data.tasks.filter((task) => task.status === "completed").length,
    failedTasks: data.tasks.filter((task) => task.status === "failed").length,
    evidenceRecorded: data.evidence.length,
    policyDecisions: data.policyDecisions.length,
    pendingApprovals: data.approvals.filter((approval) => approval.status === "pending")
      .length
  };
}

function formatTaskStatusCounts(tasks: TaskReportRow[]): string {
  const counts = new Map<string, number>();

  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return "- none";
  }

  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `- ${status}: ${count}`)
    .join("\n");
}

function listOrNone<T>(items: T[], formatter: (item: T) => string): string {
  if (items.length === 0) {
    return "- none";
  }

  return items.map(formatter).join("\n");
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

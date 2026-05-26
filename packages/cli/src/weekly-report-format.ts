import type { TaskReportRow, WeeklyReportData } from "./weekly-report-types.js";

export function formatWeeklyReport(input: {
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

export function summarizeWeeklyReport(data: WeeklyReportData): {
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

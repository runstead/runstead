import type {
  EvidenceReportRow,
  LaunchReadinessReportData,
  TaskReportRow
} from "./launch-readiness-data.js";
import {
  currentCommandEvidence,
  currentEvidenceRows
} from "./launch-readiness-evidence.js";
import type {
  LaunchReadinessTarget,
  LaunchReadinessTargetStatus
} from "./launch-readiness-types.js";
import type { LaunchReadinessStatus } from "./launch-readiness-trust.js";

export function releaseBlockers(
  data: LaunchReadinessReportData,
  target: LaunchReadinessTarget
): string[] {
  const hasVerifierEvidence = currentCommandEvidence(data).length > 0;

  return [
    ...data.gate.blockers,
    ...(data.goals.length === 0 ? ["no startup goal exists"] : []),
    ...(data.repo.commands.test.detected ? [] : ["test command is missing"]),
    ...(data.repo.commands.lint.detected ? [] : ["lint command is missing"]),
    ...(data.repo.commands.typecheck.detected ? [] : ["typecheck command is missing"]),
    ...(data.repo.commands.build.detected ? [] : ["build command is missing"]),
    ...(target === "local" || data.repo.ci.detected
      ? []
      : ["CI configuration is missing"]),
    ...(data.protectedPathChanges.length === 0
      ? []
      : [
          `protected path changes require review: ${data.protectedPathChanges.join(", ")}`
        ]),
    ...unresolvedTaskBlockers({
      ...data,
      hasVerifierEvidence
    }),
    ...data.approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => `approval ${approval.id} is pending`)
  ];
}

export function launchReadinessTargetStatus(
  target: LaunchReadinessTarget,
  status: LaunchReadinessStatus
): LaunchReadinessTargetStatus {
  if (target === "local") {
    return status === "launch_ready" ? "local_launch_ready" : "local_launch_blocked";
  }

  if (target === "staging") {
    return status === "launch_ready"
      ? "staging_launch_ready"
      : "staging_launch_blocked";
  }

  return status === "launch_ready" ? "public_launch_ready" : "public_launch_blocked";
}

function unresolvedTaskBlockers(
  data: LaunchReadinessReportData & { hasVerifierEvidence: boolean }
): string[] {
  return latestTaskPerType(scopedTaskBlockerTasks(data))
    .filter((task) => ["failed", "blocked", "waiting_approval"].includes(task.status))
    .filter((task) => !taskBlockerResolvedByEvidence(task, data))
    .map((task) => `task ${task.id} (${task.type}) is ${task.status}`);
}

function scopedTaskBlockerTasks(data: LaunchReadinessReportData): TaskReportRow[] {
  const latestGoal = data.goals
    .toSorted(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at) ||
        right.id.localeCompare(left.id)
    )
    .at(0);

  return latestGoal === undefined
    ? data.tasks
    : data.tasks.filter((task) => task.goal_id === latestGoal.id);
}

function latestTaskPerType(tasks: TaskReportRow[]): TaskReportRow[] {
  const latest = new Map<string, TaskReportRow>();

  for (const task of tasks) {
    const current = latest.get(task.type);

    if (
      current === undefined ||
      Date.parse(task.updated_at) > Date.parse(current.updated_at) ||
      (task.updated_at === current.updated_at && task.id.localeCompare(current.id) > 0)
    ) {
      latest.set(task.type, task);
    }
  }

  return [...latest.values()];
}

function taskBlockerResolvedByEvidence(
  task: TaskReportRow,
  data: LaunchReadinessReportData & { hasVerifierEvidence: boolean }
): boolean {
  if (
    data.hasVerifierEvidence &&
    (task.type === "run_mvp_verifiers" || task.type === "run_local_verifiers")
  ) {
    return true;
  }

  if (
    task.type === "generate_agent_context" &&
    hasEvidenceType(currentEvidenceRows(data), "startup_agent_context")
  ) {
    return true;
  }

  if (
    task.type === "define_measurement_framework" &&
    hasEvidenceType(currentEvidenceRows(data), "startup_measurement_framework")
  ) {
    return true;
  }

  if (
    task.type === "inspect_repo_readiness" &&
    hasEvidenceType(currentEvidenceRows(data), "startup_repo_readiness")
  ) {
    return true;
  }

  if (task.type === "startup_remediation" && data.gate.blockers.length === 0) {
    return true;
  }

  return false;
}

function hasEvidenceType(evidence: EvidenceReportRow[], type: string): boolean {
  return evidence.some((item) => item.type === type);
}

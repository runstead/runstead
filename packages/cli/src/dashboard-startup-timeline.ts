import type { RunsteadDatabase } from "@runstead/state-sqlite";

import type {
  DashboardStartupAgentPatch,
  DashboardStartupResolvedBlocker,
  DashboardStartupRun,
  DashboardStartupRunComparison,
  DashboardStartupRunSummary,
  DashboardStartupTimelineGroup,
  DashboardStartupTimelineItem
} from "./dashboard-types.js";

export function dashboardStartupRunComparison(runs: DashboardStartupRun[]): {
  runComparison?: DashboardStartupRunComparison;
} {
  const latestCompleted = runs.find((run) => run.status === "completed");
  const latestBlocked = runs.find(
    (run) => run.id !== latestCompleted?.id && startupRunBlockedOrInterrupted(run)
  );

  if (latestCompleted === undefined && latestBlocked === undefined) {
    return {};
  }

  const completedBlockers = new Set(latestCompleted?.blockers ?? []);
  const blockedBlockers = new Set(latestBlocked?.blockers ?? []);
  const resolvedBlockers =
    latestCompleted === undefined
      ? []
      : [...blockedBlockers].filter((blocker) => !completedBlockers.has(blocker));
  const stillBlocked = [...blockedBlockers].filter((blocker) =>
    completedBlockers.has(blocker)
  );
  const resolvedBlockerDetails = dashboardStartupResolvedBlockerDetails({
    latestCompleted,
    latestBlocked,
    resolvedBlockers
  });

  return {
    runComparison: {
      ...(latestCompleted === undefined
        ? {}
        : { latestCompleted: dashboardStartupRunSummary(latestCompleted) }),
      ...(latestBlocked === undefined
        ? {}
        : { latestBlocked: dashboardStartupRunSummary(latestBlocked) }),
      resolvedBlockers,
      resolvedBlockerDetails,
      stillBlocked,
      narrative: startupRunComparisonNarrative({
        latestCompleted,
        latestBlocked,
        resolvedBlockers,
        stillBlocked
      })
    }
  };
}

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

function startupRunBlockedOrInterrupted(run: DashboardStartupRun): boolean {
  return (
    run.status === "blocked" ||
    run.status === "failed" ||
    run.status === "interrupted" ||
    run.verdict.endsWith("_blocked") ||
    run.blockers.length > 0
  );
}

function dashboardStartupRunSummary(
  run: DashboardStartupRun
): DashboardStartupRunSummary {
  return {
    id: run.id,
    status: run.status,
    verdict: run.verdict,
    target: run.target,
    ...(run.startedAt === undefined ? {} : { startedAt: run.startedAt }),
    ...(run.completedAt === undefined ? {} : { completedAt: run.completedAt }),
    blockerCount: run.blockers.length,
    phaseStatuses: run.timeline.map((item) => ({
      phase: item.phase,
      status: item.status
    }))
  };
}

function dashboardStartupResolvedBlockerDetails(input: {
  latestCompleted: DashboardStartupRun | undefined;
  latestBlocked: DashboardStartupRun | undefined;
  resolvedBlockers: string[];
}): DashboardStartupResolvedBlocker[] {
  if (input.latestCompleted === undefined || input.latestBlocked === undefined) {
    return [];
  }

  const completedByPhase = new Map(
    input.latestCompleted.timeline.map((item) => [item.phase, item])
  );

  return input.resolvedBlockers.map((blocker) => {
    const blockedPhases = input.latestBlocked?.timeline.filter((item) =>
      item.blockers.includes(blocker)
    );
    const phases = [...new Set(blockedPhases?.map((item) => item.phase) ?? [])];
    const completedPhases = phases
      .map((phase) => completedByPhase.get(phase))
      .filter((item): item is DashboardStartupTimelineItem => item !== undefined);
    const evidenceIds = [
      ...new Set(completedPhases.flatMap((item) => item.evidenceIds))
    ];
    const artifacts = [...new Set(completedPhases.flatMap((item) => item.artifacts))];
    const successfulPhase = completedPhases.find((item) => item.status === "passed");
    const resolution =
      successfulPhase === undefined
        ? phases.length === 0
          ? "Resolved in the latest completed run; no matching phase was recorded."
          : `Resolved in the latest completed run after phase(s): ${phases.join(", ")}.`
        : `Resolved by phase ${successfulPhase.title} with status ${successfulPhase.status}.`;

    return {
      blocker,
      phases,
      evidenceIds,
      artifacts,
      resolution
    };
  });
}

function startupRunComparisonNarrative(input: {
  latestCompleted: DashboardStartupRun | undefined;
  latestBlocked: DashboardStartupRun | undefined;
  resolvedBlockers: string[];
  stillBlocked: string[];
}): string {
  if (input.latestCompleted !== undefined && input.latestBlocked !== undefined) {
    return `Latest completed run ${input.latestCompleted.id} is compared with blocked/interrupted run ${input.latestBlocked.id}; ${input.resolvedBlockers.length} blocker(s) resolved and ${input.stillBlocked.length} blocker(s) still shared.`;
  }

  if (input.latestCompleted !== undefined) {
    return `Latest completed run ${input.latestCompleted.id} has no blocked/interrupted run to compare.`;
  }

  return `Latest blocked/interrupted run ${input.latestBlocked?.id ?? "unknown"} has no completed recovery run yet.`;
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

function dashboardWorkerRunTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, task_id, worker_type, status, started_at, ended_at
      FROM worker_runs
      ORDER BY started_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as WorkerRunTimelineRow[];

  return {
    group: "worker_runs",
    title: "Worker Runs",
    items: rows.map((row) => ({
      id: row.id,
      title: row.worker_type,
      status: row.status,
      createdAt: row.started_at,
      detail: `task=${row.task_id}${row.ended_at === null ? "" : ` ended=${row.ended_at}`}`,
      artifacts: []
    }))
  };
}

function dashboardModelRequestTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT event_id, type, aggregate_id, payload_json, created_at
      FROM events
      WHERE type LIKE 'model_request.%'
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as ModelRequestTimelineRow[];

  return {
    group: "model_requests",
    title: "Model Requests",
    items: rows.map((row) => ({
      id: row.event_id,
      title: row.type,
      status: modelRequestTimelineStatus(row.type),
      createdAt: row.created_at,
      detail: modelRequestTimelineDetail(row),
      artifacts: []
    }))
  };
}

function dashboardToolCallTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, worker_run_id, task_id, action_type, status, started_at, ended_at
      FROM tool_calls
      ORDER BY started_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as ToolCallTimelineRow[];

  return {
    group: "tool_calls",
    title: "Tool Calls",
    items: rows.map((row) => ({
      id: row.id,
      title: row.action_type,
      status: row.status,
      createdAt: row.started_at,
      detail: `task=${row.task_id} worker=${row.worker_run_id}${row.ended_at === null ? "" : ` ended=${row.ended_at}`}`,
      artifacts: []
    }))
  };
}

function dashboardApprovalTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, action_id, status, risk, reason, updated_at
      FROM approvals
      ORDER BY updated_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as ApprovalTimelineRow[];

  return {
    group: "approvals",
    title: "Approvals",
    items: rows.map((row) => ({
      id: row.id,
      title: row.action_id,
      status: row.status,
      createdAt: row.updated_at,
      detail: `${row.risk}: ${row.reason}`,
      artifacts: []
    }))
  };
}

function dashboardEvidenceTimelineGroup(
  database: RunsteadDatabase
): DashboardStartupTimelineGroup {
  const rows = database
    .prepare(
      `
      SELECT id, type, subject_type, subject_id, summary, uri, created_at
      FROM evidence
      ORDER BY created_at DESC, id DESC
      LIMIT 25
    `
    )
    .all() as unknown as EvidenceTimelineRow[];

  return {
    group: "evidence",
    title: "Evidence",
    items: rows.map((row) => ({
      id: row.id,
      title: row.type,
      status: "recorded",
      createdAt: row.created_at,
      detail: `${row.subject_type}/${row.subject_id}: ${row.summary ?? "no summary"}`,
      artifacts: [row.uri]
    }))
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

function modelRequestTimelineStatus(type: string): string {
  if (type.endsWith(".retry")) {
    return "retry";
  }

  if (type.endsWith(".failed")) {
    return "failed";
  }

  if (type.endsWith(".completed")) {
    return "completed";
  }

  return "recorded";
}

function modelRequestTimelineDetail(row: ModelRequestTimelineRow): string {
  const payload = parseJsonRecord(row.payload_json);
  const attempt =
    typeof payload?.attempt === "number" ? `attempt=${payload.attempt}` : undefined;
  const reason =
    typeof payload?.reason === "string" ? `reason=${payload.reason}` : undefined;
  const delayMs =
    typeof payload?.delayMs === "number" ? `delay=${payload.delayMs}ms` : undefined;

  return [row.aggregate_id, attempt, reason, delayMs]
    .filter((part): part is string => part !== undefined)
    .join(" ");
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

interface WorkerRunTimelineRow {
  id: string;
  task_id: string;
  worker_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface ModelRequestTimelineRow {
  event_id: string;
  type: string;
  aggregate_id: string;
  payload_json: string;
  created_at: string;
}

interface ToolCallTimelineRow {
  id: string;
  worker_run_id: string;
  task_id: string;
  action_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

interface ApprovalTimelineRow {
  id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  updated_at: string;
}

interface EvidenceTimelineRow {
  id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  summary: string | null;
  uri: string;
  created_at: string;
}

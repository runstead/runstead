import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type RunsteadEvent } from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import {
  dashboardOperatorActionDescriptor,
  dashboardOperatorMutationPath,
  executeDashboardOperatorApiAction,
  recordDashboardOperatorApiEvent
} from "./dashboard-operator-api-actions.js";
import { buildDashboardOperatorConsole } from "./dashboard-operator-console.js";
import { dashboardEventPayload } from "./dashboard-event-payload.js";
import {
  dashboardOperatorApiAuthError,
  dashboardOperatorApiError,
  listen,
  localBindHost,
  readJsonRequestBody,
  respondJson,
  serverPort,
  urlHost
} from "./dashboard-operator-api-http.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { getStartupStatus } from "./startup-status.js";
import type {
  BuildDashboardOptions,
  BuildDashboardResult,
  DashboardApproval,
  DashboardDaemonStatus,
  DashboardEvent,
  DashboardGoal,
  DashboardOperatorApiConfig,
  DashboardOperatorConsole,
  DashboardRepository,
  DashboardSnapshot,
  DashboardStartupAgentPatch,
  DashboardStartupGuidedStep,
  DashboardStartupOperatorCommand,
  DashboardStartupResolvedBlocker,
  DashboardStartupRun,
  DashboardStartupRunComparison,
  DashboardStartupRunSummary,
  DashboardStartupSnapshot,
  DashboardStartupTimelineGroup,
  DashboardStartupTimelineItem,
  DashboardSummary,
  DashboardTask,
  ServeDashboardOptions,
  ServeDashboardResult
} from "./dashboard-types.js";

export type {
  BuildDashboardOptions,
  BuildDashboardResult,
  DashboardApproval,
  DashboardDaemonStatus,
  DashboardEvent,
  DashboardGoal,
  DashboardOperatorAction,
  DashboardOperatorApiSession,
  DashboardOperatorConsole,
  DashboardOperatorPendingApproval,
  DashboardOperatorRunContext,
  DashboardRepository,
  DashboardSnapshot,
  DashboardStartupAgentPatch,
  DashboardStartupGuidedStep,
  DashboardStartupOperatorCommand,
  DashboardStartupResolvedBlocker,
  DashboardStartupRun,
  DashboardStartupRunComparison,
  DashboardStartupRunPhaseSummary,
  DashboardStartupRunSummary,
  DashboardStartupSnapshot,
  DashboardStartupStaleEvidence,
  DashboardStartupTimelineEntry,
  DashboardStartupTimelineGroup,
  DashboardStartupTimelineItem,
  DashboardSummary,
  DashboardTask,
  ServeDashboardOptions,
  ServeDashboardResult
} from "./dashboard-types.js";

export async function buildDashboard(
  options: BuildDashboardOptions = {}
): Promise<BuildDashboardResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolvedState = await requireRunsteadStateDb(cwd);
  const root = resolvedState.root;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const stateDb = resolvedState.stateDb;
  const outputDir =
    options.outputDir === undefined
      ? join(root, "dashboard")
      : resolve(options.outputDir);
  const htmlPath = join(outputDir, "index.html");
  const dataPath = join(outputDir, "state.json");
  const operatorActionsPath = join(outputDir, "operator-actions.json");
  const database = openRunsteadDatabase(stateDb);

  try {
    const baseSnapshot = readDashboardSnapshot(database, generatedAt);
    const daemon = await readDashboardDaemonStatus(root, generatedAt);
    const startup = await readDashboardStartupStatus({
      cwd,
      root,
      generatedAt,
      database
    });
    const snapshot: DashboardSnapshot = {
      ...baseSnapshot,
      daemon,
      startup,
      operator: buildDashboardOperatorConsole({
        cwd,
        daemon,
        startup,
        approvals: baseSnapshot.approvals
      })
    };
    const html = formatDashboardHtml(snapshot);
    const event: RunsteadEvent = {
      eventId: createRunsteadId("evt"),
      type: "dashboard.generated",
      aggregateType: "dashboard",
      aggregateId: "local",
      payload: dashboardEventPayload(snapshot, htmlPath, dataPath),
      createdAt: generatedAt
    };

    await mkdir(outputDir, { recursive: true });
    await writeFile(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await writeFile(
      operatorActionsPath,
      `${JSON.stringify(snapshot.operator, null, 2)}\n`,
      "utf8"
    );
    await writeFile(htmlPath, html, "utf8");
    appendEventAndProject(database, { event });

    return {
      cwd,
      root,
      stateDb,
      outputDir,
      htmlPath,
      dataPath,
      operatorActionsPath,
      snapshot,
      event
    };
  } finally {
    database.close();
  }
}

export async function serveDashboard(
  options: ServeDashboardOptions = {}
): Promise<ServeDashboardResult> {
  const build = await buildDashboard(options);
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4173;
  const operatorApi = dashboardOperatorApiConfig(options, host);
  const server = createServer((request, response) => {
    void serveDashboardRequest({ build, host, operatorApi, request, response });
  });

  await listen(server, requestedPort, host);

  const port = serverPort(server);

  return {
    build,
    server,
    host,
    port,
    url: `http://${urlHost(host)}:${port}`,
    ...(operatorApi.enabled ? { operatorApi } : {})
  };
}

function dashboardOperatorApiConfig(
  options: ServeDashboardOptions,
  host: string
): DashboardOperatorApiConfig {
  if (options.enableOperatorApi !== true) {
    return { enabled: false };
  }

  if (!localBindHost(host)) {
    throw new Error(
      "Operator API is local-only. Use --host 127.0.0.1 or --host ::1 when --enable-operator-api is set."
    );
  }

  return {
    enabled: true,
    sessionToken: options.sessionToken ?? randomBytes(24).toString("hex"),
    csrfToken: options.csrfToken ?? randomBytes(24).toString("hex"),
    actor: options.actor ?? "local-admin"
  };
}

async function serveDashboardRequest(input: {
  build: BuildDashboardResult;
  host: string;
  operatorApi: DashboardOperatorApiConfig;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(input.request.url ?? "/", `http://${input.host}`);
  const pathname = requestUrl.pathname;

  if (dashboardOperatorMutationPath(pathname)) {
    await serveDashboardOperatorApiRequest({
      build: input.build,
      operatorApi: input.operatorApi,
      request: input.request,
      response: input.response,
      pathname
    });
    return;
  }

  if (
    input.request.method !== undefined &&
    !["GET", "HEAD"].includes(input.request.method)
  ) {
    input.response.writeHead(405, {
      allow: "GET, HEAD",
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end("Method not allowed");
    return;
  }

  const target =
    pathname === "/" || pathname === "/index.html"
      ? {
          path: input.build.htmlPath,
          contentType: "text/html; charset=utf-8"
        }
      : pathname === "/state.json"
        ? {
            path: input.build.dataPath,
            contentType: "application/json; charset=utf-8"
          }
        : pathname === "/operator-actions.json"
          ? {
              path: input.build.operatorActionsPath,
              contentType: "application/json; charset=utf-8"
            }
          : undefined;

  if (target === undefined) {
    input.response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end("Not found");
    return;
  }

  try {
    const body = await readFile(target.path);

    input.response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": target.contentType
    });
    input.response.end(input.request.method === "HEAD" ? undefined : body);
  } catch (error) {
    input.response.writeHead(500, {
      "content-type": "text/plain; charset=utf-8"
    });
    input.response.end(error instanceof Error ? error.message : String(error));
  }
}

async function serveDashboardOperatorApiRequest(input: {
  build: BuildDashboardResult;
  operatorApi: DashboardOperatorApiConfig;
  request: IncomingMessage;
  response: ServerResponse;
  pathname: string;
}): Promise<void> {
  if (!input.operatorApi.enabled) {
    respondJson(input.response, 404, {
      error: "operator_api_disabled",
      message:
        "Operator API is disabled. Restart dashboard serve with --enable-operator-api."
    });
    return;
  }

  if (input.request.method !== "POST") {
    respondJson(
      input.response,
      405,
      {
        error: "method_not_allowed",
        message: "Operator API endpoints require POST."
      },
      {
        allow: "POST"
      }
    );
    return;
  }

  const authError = dashboardOperatorApiAuthError(input.request, input.operatorApi);

  if (authError !== undefined) {
    respondJson(input.response, 403, authError);
    return;
  }

  let body: Record<string, unknown>;

  try {
    body = await readJsonRequestBody(input.request);
  } catch (error) {
    respondJson(input.response, 400, {
      error: "invalid_json",
      message: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  const action = dashboardOperatorActionDescriptor(input.pathname, body);

  try {
    const result = await executeDashboardOperatorApiAction({
      build: input.build,
      actor: input.operatorApi.actor,
      action,
      body,
      rebuildDashboard: buildDashboard
    });

    recordDashboardOperatorApiEvent({
      build: input.build,
      actor: input.operatorApi.actor,
      action,
      status: "completed",
      result
    });
    respondJson(input.response, 200, {
      ok: true,
      action,
      result
    });
  } catch (error) {
    const apiError = dashboardOperatorApiError(error);

    recordDashboardOperatorApiEvent({
      build: input.build,
      actor: input.operatorApi.actor,
      action,
      status: "failed",
      error: apiError.message
    });
    respondJson(input.response, apiError.statusCode, {
      ok: false,
      action,
      error: apiError.code,
      message: apiError.message
    });
  }
}

function readDashboardSnapshot(
  database: RunsteadDatabase,
  generatedAt: string
): DashboardSnapshot {
  const repositories = (
    database
      .prepare(
        `
        SELECT id, alias, local_path, remote_url, status
        FROM repositories
        ORDER BY alias ASC, id ASC
      `
      )
      .all() as unknown as RepositoryRow[]
  ).map(rowToRepository);
  const goals = (
    database
      .prepare(
        `
        SELECT id, domain, title, status, priority, scope_json, updated_at
        FROM goals
        ORDER BY updated_at DESC, id ASC
        LIMIT 50
      `
      )
      .all() as unknown as GoalRow[]
  ).map(rowToGoal);
  const tasks = (
    database
      .prepare(
        `
        SELECT id, goal_id, type, status, priority, updated_at
        FROM tasks
        ORDER BY updated_at DESC, id ASC
        LIMIT 50
      `
      )
      .all() as unknown as TaskRow[]
  ).map(rowToTask);
  const approvals = (
    database
      .prepare(
        `
        SELECT id, action_id, status, risk, reason, updated_at
        FROM approvals
        ORDER BY updated_at DESC, id ASC
        LIMIT 25
      `
      )
      .all() as unknown as ApprovalRow[]
  ).map(rowToApproval);
  const events = (
    database
      .prepare(
        `
        SELECT event_id, type, aggregate_type, aggregate_id, created_at
        FROM events
        ORDER BY created_at DESC, id DESC
        LIMIT 25
      `
      )
      .all() as unknown as EventRow[]
  ).map(rowToEvent);

  return {
    generatedAt,
    summary: readDashboardSummary(database),
    repositories,
    goals,
    tasks,
    approvals,
    events,
    daemon: {
      available: false
    },
    startup: {
      available: false,
      timelineGroups: [],
      staleEvidence: []
    },
    operator: {
      actions: [],
      pendingApprovals: [],
      blockerCount: 0,
      staleEvidenceCount: 0
    }
  };
}

async function readDashboardStartupStatus(input: {
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

async function readStartupRuns(root: string): Promise<DashboardStartupRun[]> {
  const dirs = [join(root, "startup", "readiness-runs"), join(root, "startup", "runs")];

  return (
    await Promise.all(
      dirs.map(async (dir) => {
        try {
          return await Promise.all(
            (await readdir(dir))
              .filter((name) => name.endsWith(".json"))
              .map((name) => readStartupRunFile(join(dir, name)))
          );
        } catch {
          return [];
        }
      })
    )
  )
    .flat()
    .filter((run): run is DashboardStartupRun => run !== undefined)
    .sort((left, right) =>
      startupRunSortTime(right).localeCompare(startupRunSortTime(left))
    );
}

async function readStartupRunFile(
  path: string
): Promise<DashboardStartupRun | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return undefined;
    }

    const phases = Array.isArray(parsed.phases) ? parsed.phases.filter(isRecord) : [];
    const guidedFlow = Array.isArray(parsed.guidedFlow)
      ? parsed.guidedFlow.filter(isRecord).map(rowToStartupGuidedStep)
      : [];
    const operatorCommands = Array.isArray(parsed.operatorCommands)
      ? parsed.operatorCommands.filter(isRecord).map(rowToStartupOperatorCommand)
      : [];
    const startedAt = stringField(parsed.startedAt);
    const completedAt = stringField(parsed.completedAt);

    return {
      id: stringField(parsed.id) ?? "unknown",
      stage: stringField(parsed.stage) ?? "unknown",
      target: stringField(parsed.target) ?? "unknown",
      status: stringField(parsed.status) ?? "unknown",
      verdict: stringField(parsed.verdict) ?? "not_evaluated",
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(completedAt === undefined ? {} : { completedAt }),
      blockers: stringArrayField(parsed.verdictBlockers),
      reports: stringArrayField(parsed.reportPaths),
      guidedFlow,
      operatorCommands,
      uiSmokeArtifacts: phases
        .filter((phase) => stringField(phase.id) === "ui_smoke")
        .flatMap((phase) => stringArrayField(phase.artifacts)),
      timeline: phases.map((phase) => {
        const phaseId = stringField(phase.id) ?? "unknown";
        const nextAction = stringField(phase.nextAction);
        const evidenceIds = stringArrayField(phase.evidenceIds);

        return {
          phase: phaseId,
          title: stringField(phase.title) ?? phaseId,
          status: stringField(phase.status) ?? "unknown",
          evidence: evidenceIds.length,
          evidenceIds,
          artifacts: stringArrayField(phase.artifacts),
          blockers: stringArrayField(phase.blockers),
          ...(nextAction === undefined ? {} : { nextAction })
        };
      })
    };
  } catch {
    return undefined;
  }
}

function rowToStartupGuidedStep(
  row: Record<string, unknown>
): DashboardStartupGuidedStep {
  const id = stringField(row.id) ?? "unknown";

  return {
    id,
    title: stringField(row.title) ?? id,
    status: stringField(row.status) ?? "unknown",
    resolution: stringField(row.resolution) ?? "unknown",
    why: stringField(row.why) ?? "",
    nextAction: stringField(row.nextAction) ?? "",
    ...(stringField(row.command) === undefined
      ? {}
      : { command: stringField(row.command) ?? "" }),
    blockers: stringArrayField(row.blockers)
  };
}

function rowToStartupOperatorCommand(
  row: Record<string, unknown>
): DashboardStartupOperatorCommand {
  const kind = stringField(row.kind) ?? "unknown";

  return {
    kind,
    title: stringField(row.title) ?? kind,
    command: stringField(row.command) ?? "",
    when: stringField(row.when) ?? ""
  };
}

function startupRunSortTime(run: DashboardStartupRun): string {
  return run.completedAt ?? run.startedAt ?? "";
}

function dashboardStartupRunComparison(runs: DashboardStartupRun[]): {
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

function dashboardStartupTimelineGroups(input: {
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

function latestStartupAgentPatch(database: RunsteadDatabase): {
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

async function readDashboardDaemonStatus(
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

function readDashboardSummary(database: RunsteadDatabase): DashboardSummary {
  return {
    repositories: countRows(database, "repositories"),
    activeGoals: countRows(database, "goals", "status = 'active'"),
    queuedTasks: countRows(database, "tasks", "status = 'queued'"),
    runningTasks: countRows(database, "tasks", "status IN ('claimed', 'running')"),
    failedTasks: countRows(database, "tasks", "status = 'failed'"),
    pendingApprovals: countRows(database, "approvals", "status = 'pending'")
  };
}

function countRows(database: RunsteadDatabase, table: string, where?: string): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${table}${where === undefined ? "" : ` WHERE ${where}`}`
    )
    .get() as { count: number };

  return row.count;
}

function formatDashboardHtml(snapshot: DashboardSnapshot): string {
  const summary = snapshot.summary;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Runstead Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #1f2937;
      --muted: #64748b;
      --line: #d8dee8;
      --accent: #0f766e;
      --risk: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.45;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      padding: 20px 28px;
    }
    main {
      display: grid;
      gap: 20px;
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px;
    }
    h1, h2 {
      margin: 0;
      font-weight: 650;
      letter-spacing: 0;
    }
    h1 { font-size: 24px; }
    h2 { font-size: 16px; }
    .muted { color: var(--muted); }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .metric, section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .metric { padding: 14px 16px; }
    .metric strong {
      display: block;
      font-size: 26px;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    section { overflow: hidden; }
    section header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      padding: 14px 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: 0; }
    code {
      color: var(--accent);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .status-failed, .risk-critical, .risk-high { color: var(--risk); font-weight: 650; }
    .status-blocked { color: var(--risk); font-weight: 650; }
    .status-passed { color: var(--accent); font-weight: 650; }
    .empty { padding: 16px; color: var(--muted); }
    .operator-actions {
      display: grid;
      gap: 0;
    }
    .operator-action {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(240px, 2fr) auto auto;
      gap: 12px;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
    }
    .operator-action:last-child { border-bottom: 0; }
    .operator-action button, .operator-api button {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 6px;
      color: var(--text);
      cursor: pointer;
      font: inherit;
      min-height: 32px;
      padding: 5px 10px;
      white-space: nowrap;
    }
    .operator-action button.primary, .operator-api button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #ffffff;
    }
    .operator-action button:focus-visible, .operator-api button:focus-visible,
    .operator-api input:focus-visible, .operator-api select:focus-visible,
    .operator-api textarea:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .operator-api {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--line);
      background: #f9fafb;
    }
    .operator-api input, .operator-api select, .operator-api textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      min-height: 32px;
      padding: 5px 8px;
    }
    .operator-api textarea {
      min-height: 64px;
      resize: vertical;
    }
    .operator-result {
      grid-column: 1 / -1;
      min-height: 20px;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      .operator-action {
        grid-template-columns: 1fr;
      }
      .operator-action button {
        justify-self: start;
      }
    }
  </style>
  <script>
    async function copyOperatorCommand(button) {
      const command = button.getAttribute("data-command") || "";
      try {
        await navigator.clipboard.writeText(command);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => { button.textContent = "Copy"; }, 1400);
    }
    function operatorApiHeaders() {
      const session = document.querySelector("[data-operator-session]")?.value || "";
      const csrf = document.querySelector("[data-operator-csrf]")?.value || "";
      return {
        "content-type": "application/json",
        "authorization": "Bearer " + session,
        "x-runstead-csrf-token": csrf
      };
    }
    function setOperatorResult(message) {
      const target = document.querySelector("[data-operator-result]");
      if (target) target.textContent = message;
    }
    function operatorField(selector) {
      return document.querySelector(selector)?.value || "";
    }
    function splitOperatorList(value) {
      return value.split(/[\\n,]/).map((item) => item.trim()).filter(Boolean);
    }
    async function postOperatorApi(path, body) {
      const response = await fetch(path, {
        method: "POST",
        headers: operatorApiHeaders(),
        body: JSON.stringify(body || {})
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "operator action failed");
      }
      return payload;
    }
    async function runOperatorAction(button) {
      const id = button.getAttribute("data-operator-action-id");
      if (!id) return;
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/operator-actions/" + encodeURIComponent(id) + "/run", {});
        setOperatorResult("Completed " + id + ": " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
    async function decideOperatorApproval(button) {
      const id = button.getAttribute("data-approval-id");
      const decision = button.getAttribute("data-approval-decision");
      if (!id || !decision) return;
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/approvals/" + encodeURIComponent(id) + "/" + decision, {});
        setOperatorResult("Approval " + id + " " + decision + ": " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
    async function runVerifiersForm(button) {
      const taskId = operatorField("[data-verifier-task-id]").trim();
      if (!taskId) {
        setOperatorResult("taskId is required");
        return;
      }
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/verifiers/run", {
          taskId,
          mode: operatorField("[data-verifier-mode]") || "evidence_only"
        });
        setOperatorResult("Verifiers completed: " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
    async function recordManualEvidenceForm(button) {
      const summary = operatorField("[data-manual-evidence-summary]").trim();
      if (!summary) {
        setOperatorResult("summary is required");
        return;
      }
      const body = {
        type: operatorField("[data-manual-evidence-type]") || "manual_change",
        summary,
        gate: operatorField("[data-manual-evidence-gate]"),
        sourceRefs: splitOperatorList(operatorField("[data-manual-evidence-source-refs]")),
        content: operatorField("[data-manual-evidence-content]")
      };
      button.disabled = true;
      try {
        const payload = await postOperatorApi("/evidence/manual", body);
        setOperatorResult("Evidence recorded: " + JSON.stringify(payload.result || payload));
      } catch (error) {
        setOperatorResult(error instanceof Error ? error.message : String(error));
      } finally {
        button.disabled = false;
      }
    }
  </script>
</head>
<body>
  <header>
    <h1>Runstead Dashboard</h1>
    <div class="muted">Generated ${escapeHtml(snapshot.generatedAt)}</div>
  </header>
  <main>
    <div class="summary">
      ${metric("Repositories", summary.repositories)}
      ${metric("Active Goals", summary.activeGoals)}
      ${metric("Queued Tasks", summary.queuedTasks)}
      ${metric("Running Tasks", summary.runningTasks)}
      ${metric("Failed Tasks", summary.failedTasks)}
      ${metric("Pending Approvals", summary.pendingApprovals)}
    </div>
    ${operatorConsoleSection(snapshot.operator)}
    ${startupSection(snapshot.startup)}
    ${daemonSection(snapshot.daemon)}
    ${tableSection(
      "Repositories",
      snapshot.repositories,
      ["Alias", "Status", "Path"],
      (item) => [
        `<code>${escapeHtml(item.alias)}</code>`,
        statusCell(item.status),
        escapeHtml(item.localPath)
      ]
    )}
    ${tableSection(
      "Goals",
      snapshot.goals,
      ["Title", "Status", "Repository", "Updated"],
      (item) => [
        escapeHtml(item.title),
        statusCell(item.status),
        escapeHtml(item.repositoryAlias ?? "local"),
        escapeHtml(item.updatedAt)
      ]
    )}
    ${tableSection(
      "Tasks",
      snapshot.tasks,
      ["Type", "Status", "Priority", "Updated"],
      (item) => [
        `<code>${escapeHtml(item.type)}</code>`,
        statusCell(item.status),
        escapeHtml(item.priority),
        escapeHtml(item.updatedAt)
      ]
    )}
    ${tableSection(
      "Approvals",
      snapshot.approvals,
      ["Action", "Status", "Risk", "Reason"],
      (item) => [
        `<code>${escapeHtml(item.actionId)}</code>`,
        statusCell(item.status),
        riskCell(item.risk),
        escapeHtml(item.reason)
      ]
    )}
    ${tableSection(
      "Recent Events",
      snapshot.events,
      ["Type", "Aggregate", "Created"],
      (item) => [
        `<code>${escapeHtml(item.type)}</code>`,
        `${escapeHtml(item.aggregateType)}/${escapeHtml(item.aggregateId)}`,
        escapeHtml(item.createdAt)
      ]
    )}
  </main>
</body>
</html>
`;
}

function metric(label: string, value: number): string {
  return `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)}</span></div>`;
}

function operatorConsoleSection(operator: DashboardOperatorConsole): string {
  const recommended =
    operator.recommendedAction === undefined
      ? "none"
      : `${operator.recommendedAction.title}: ${operator.recommendedAction.reason}`;
  const run = operator.currentRun;
  const pendingApprovals =
    operator.pendingApprovals.length === 0
      ? "none"
      : operator.pendingApprovals
          .map(
            (approval) =>
              `<code>${escapeHtml(approval.id)}</code> ${escapeHtml(approval.risk)}
              <button type="button" class="primary" data-approval-id="${escapeHtml(approval.id)}" data-approval-decision="approve" onclick="decideOperatorApproval(this)">Approve</button>
              <button type="button" data-approval-id="${escapeHtml(approval.id)}" data-approval-decision="deny" onclick="decideOperatorApproval(this)">Deny</button>
              <br><code>${escapeHtml(approval.command)}</code>`
          )
          .join("<br>");

  if (operator.actions.length === 0) {
    return `<section><header><h2>Operator Console</h2><span class="muted">0 actions</span></header>${operatorConsoleContextTable(operator, pendingApprovals)}<div class="empty">No operator actions are available.</div>${operatorApiPanel()}</section>`;
  }

  const rows = operator.actions
    .map(
      (action) => `<div class="operator-action">
        <div><strong>${escapeHtml(action.title)}</strong><br><span class="muted">${escapeHtml(action.source)} · ${statusCell(action.status)}</span></div>
        <div><code>${escapeHtml(action.command)}</code><br><span class="muted">${escapeHtml(action.reason)}</span></div>
        <button type="button" data-command="${escapeHtml(action.command)}" onclick="copyOperatorCommand(this)">Copy</button>
        <button type="button" class="primary" data-operator-action-id="${escapeHtml(action.id)}" onclick="runOperatorAction(this)">Run</button>
      </div>`
    )
    .join("");

  return `<section>
    <header><h2>Operator Console</h2><span class="muted">${operator.actions.length} action${operator.actions.length === 1 ? "" : "s"}</span></header>
    <table><tbody>
      <tr><th>Current run</th><td>${
        run === undefined
          ? "none"
          : `<code>${escapeHtml(run.id)}</code> ${statusCell(run.status)} target=${escapeHtml(run.target)} verdict=${escapeHtml(run.verdict)}<br><code>${escapeHtml(run.resumeCommand ?? "")}</code>`
      }</td></tr>
      <tr><th>Recommended</th><td>${escapeHtml(recommended)}</td></tr>
      <tr><th>Recommended command</th><td><code>${escapeHtml(operator.recommendedCommand ?? "none")}</code></td></tr>
      <tr><th>Blockers</th><td>${operator.blockerCount}</td></tr>
      <tr><th>Pending approvals</th><td>${pendingApprovals}</td></tr>
      <tr><th>Stale evidence</th><td>${operator.staleEvidenceCount}</td></tr>
      <tr><th>API</th><td><code>/operator-actions.json</code></td></tr>
    </tbody></table>
    <div class="operator-actions">${rows}</div>
    ${operatorApiPanel()}
  </section>`;
}

function operatorApiPanel(): string {
  return `<div class="operator-api">
    <label><span class="muted">Session token</span><input type="password" autocomplete="off" data-operator-session></label>
    <label><span class="muted">CSRF token</span><input type="password" autocomplete="off" data-operator-csrf></label>
    <label><span class="muted">Verifier task</span><input type="text" autocomplete="off" data-verifier-task-id></label>
    <label><span class="muted">Verifier mode</span><select data-verifier-mode><option value="evidence_only">evidence_only</option><option value="finalize_task">finalize_task</option></select></label>
    <button type="button" class="primary" onclick="runVerifiersForm(this)">Run verifiers</button>
    <label><span class="muted">Evidence type</span><input type="text" value="manual_change" autocomplete="off" data-manual-evidence-type></label>
    <label><span class="muted">Gate</span><select data-manual-evidence-gate><option value="">none</option><option value="idea">idea</option><option value="mvp">mvp</option><option value="launch">launch</option><option value="scale">scale</option></select></label>
    <label><span class="muted">Summary</span><input type="text" autocomplete="off" data-manual-evidence-summary></label>
    <label><span class="muted">Source refs</span><textarea data-manual-evidence-source-refs></textarea></label>
    <label><span class="muted">Content</span><textarea data-manual-evidence-content></textarea></label>
    <button type="button" class="primary" onclick="recordManualEvidenceForm(this)">Record evidence</button>
    <div class="operator-result" data-operator-result></div>
  </div>`;
}

function operatorConsoleContextTable(
  operator: DashboardOperatorConsole,
  pendingApprovals: string
): string {
  const run = operator.currentRun;

  return `<table><tbody>
    <tr><th>Current run</th><td>${
      run === undefined
        ? "none"
        : `<code>${escapeHtml(run.id)}</code> ${statusCell(run.status)} target=${escapeHtml(run.target)} verdict=${escapeHtml(run.verdict)}<br><code>${escapeHtml(run.resumeCommand ?? "")}</code>`
    }</td></tr>
    <tr><th>Recommended command</th><td><code>${escapeHtml(operator.recommendedCommand ?? "none")}</code></td></tr>
    <tr><th>Blockers</th><td>${operator.blockerCount}</td></tr>
    <tr><th>Pending approvals</th><td>${pendingApprovals}</td></tr>
    <tr><th>Stale evidence</th><td>${operator.staleEvidenceCount}</td></tr>
    <tr><th>API</th><td><code>/operator-actions.json</code></td></tr>
  </tbody></table>`;
}

function startupSection(startup: DashboardStartupSnapshot): string {
  if (!startup.available || startup.status === undefined) {
    return `<section><header><h2>Startup Readiness</h2><span class="muted">unavailable</span></header><div class="empty">${escapeHtml(startup.error ?? "Startup status is not available.")}</div></section>`;
  }

  const status = startup.status;
  const run = startup.latestRun;
  const gateRows = status.gates
    .map(
      (gate) =>
        `<tr><td>${escapeHtml(gate.stage)}</td><td>${statusCell(gate.status)}</td><td>${gate.blockers.length}</td><td>${escapeHtml(gate.blockers[0] ?? "none")}</td></tr>`
    )
    .join("");
  const blockerRows = status.gates.flatMap((gate) =>
    gate.blockers.map(
      (blocker) =>
        `<tr><td>${escapeHtml(gate.stage)}</td><td>${escapeHtml(blocker)}</td></tr>`
    )
  );
  const sources = status.evidence.sourceKinds.join(", ") || "none";
  const timelineRows =
    run === undefined
      ? ""
      : run.timeline
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.title)}</td><td>${statusCell(item.status)}</td><td>${item.evidence}</td><td>${escapeHtml(item.blockers[0] ?? item.nextAction ?? "none")}</td></tr>`
          )
          .join("");
  const staleRows = startup.staleEvidence
    .map(
      (item) =>
        `<tr><td><code>${escapeHtml(item.evidenceId)}</code></td><td>${escapeHtml(item.type)}</td><td>${item.ageDays}d / ${item.freshnessDays}d</td><td>${escapeHtml(item.uri)}</td></tr>`
    )
    .join("");
  const uiArtifacts = run?.uiSmokeArtifacts ?? [];
  const guidedRows =
    run === undefined
      ? ""
      : run.guidedFlow
          .map(
            (step) =>
              `<tr><td>${escapeHtml(step.title)}</td><td>${statusCell(step.status)}</td><td>${escapeHtml(step.resolution)}</td><td>${escapeHtml(step.nextAction)}${
                step.command === undefined
                  ? ""
                  : `<br><code>${escapeHtml(step.command)}</code>`
              }</td></tr>`
          )
          .join("");
  const operatorCommandRows =
    run === undefined
      ? ""
      : run.operatorCommands
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.title)}</td><td><code>${escapeHtml(item.command)}</code></td><td>${escapeHtml(item.when)}</td></tr>`
          )
          .join("");
  const agentPatch = startup.agentPatch;

  return `<section>
    <header><h2>Startup Readiness</h2><span class="muted">${escapeHtml(status.currentStage)}</span></header>
    <table><tbody>
      <tr><th>Latest run</th><td>${
        run === undefined
          ? "none"
          : `<code>${escapeHtml(run.id)}</code> ${statusCell(run.status)} verdict=${escapeHtml(run.verdict)} target=${escapeHtml(run.target)}`
      }</td></tr>
      <tr><th>Next action</th><td><code>${escapeHtml(status.nextAction.command)}</code><br>${escapeHtml(status.nextAction.reason)}</td></tr>
      <tr><th>Evidence</th><td>${status.evidence.total} records; sources: ${escapeHtml(sources)}; stale: ${status.evidence.staleSources.length}</td></tr>
      <tr><th>Latest report</th><td><code>${escapeHtml(startup.latestReportPath ?? "none")}</code></td></tr>
      <tr><th>UI smoke artifacts</th><td>${uiArtifacts.length === 0 ? "none" : uiArtifacts.map((artifact) => `<code>${escapeHtml(artifact)}</code>`).join("<br>")}</td></tr>
      <tr><th>Agent patch</th><td>${
        agentPatch === undefined
          ? "none"
          : `${statusCell(agentPatch.status)} task=<code>${escapeHtml(agentPatch.taskId)}</code><br>${escapeHtml(agentPatch.summary)}${
              agentPatch.filesTouched.length === 0
                ? ""
                : `<br>${agentPatch.filesTouched.map((file) => `<code>${escapeHtml(file)}</code>`).join("<br>")}`
            }`
      }</td></tr>
    </tbody></table>
    ${startupRunComparisonTable(startup.runComparison)}
    ${startupTimelineGroupsTable(startup.timelineGroups)}
    ${
      run === undefined
        ? '<div class="empty">No startup readiness run has been recorded.</div>'
        : `<table>
      <thead><tr><th>Timeline</th><th>Status</th><th>Evidence</th><th>Top blocker or next action</th></tr></thead>
      <tbody>${timelineRows}</tbody>
    </table>`
    }
    ${
      run === undefined || run.operatorCommands.length === 0
        ? '<div class="empty">No startup operator commands.</div>'
        : `<table>
      <thead><tr><th>Operator command</th><th>Command</th><th>When</th></tr></thead>
      <tbody>${operatorCommandRows}</tbody>
    </table>`
    }
    ${
      run === undefined || run.guidedFlow.length === 0
        ? '<div class="empty">No guided next steps.</div>'
        : `<table>
      <thead><tr><th>Guided next step</th><th>Status</th><th>Owner</th><th>Action</th></tr></thead>
      <tbody>${guidedRows}</tbody>
    </table>`
    }
    <table>
      <thead><tr><th>Gate</th><th>Status</th><th>Blockers</th><th>Top blocker</th></tr></thead>
      <tbody>${gateRows}</tbody>
    </table>
    ${
      blockerRows.length === 0
        ? '<div class="empty">No startup blockers.</div>'
        : `<table><thead><tr><th>Gate</th><th>Blocker board</th></tr></thead><tbody>${blockerRows.join("")}</tbody></table>`
    }
    ${
      startup.staleEvidence.length === 0
        ? '<div class="empty">No stale startup evidence sources.</div>'
        : `<table><thead><tr><th>Evidence</th><th>Type</th><th>Age</th><th>Source</th></tr></thead><tbody>${staleRows}</tbody></table>`
    }
  </section>`;
}

function startupRunComparisonTable(
  comparison: DashboardStartupRunComparison | undefined
): string {
  if (comparison === undefined) {
    return '<div class="empty">Run comparison unavailable.</div>';
  }

  const completed = comparison.latestCompleted;
  const blocked = comparison.latestBlocked;
  const resolutionRows =
    comparison.resolvedBlockerDetails.length === 0
      ? "none"
      : comparison.resolvedBlockerDetails
          .map(
            (detail) =>
              `<strong>${escapeHtml(detail.blocker)}</strong><br>${escapeHtml(detail.resolution)}<br>phases: ${escapeHtml(detail.phases.join(", ") || "none")}<br>evidence: ${escapeHtml(detail.evidenceIds.join(", ") || "none")}<br>${detail.artifacts.map((artifact) => `<code>${escapeHtml(artifact)}</code>`).join("<br>") || "artifacts: none"}`
          )
          .join("<hr>");

  return `<table>
    <thead><tr><th>Run comparison</th><th>Run</th><th>Verdict</th><th>Blockers</th></tr></thead>
    <tbody>
      <tr><td>Latest completed</td><td>${
        completed === undefined
          ? "none"
          : `<code>${escapeHtml(completed.id)}</code> ${statusCell(completed.status)}`
      }</td><td>${escapeHtml(completed?.verdict ?? "none")}</td><td>${completed?.blockerCount ?? 0}</td></tr>
      <tr><td>Latest blocked/interrupted</td><td>${
        blocked === undefined
          ? "none"
          : `<code>${escapeHtml(blocked.id)}</code> ${statusCell(blocked.status)}`
      }</td><td>${escapeHtml(blocked?.verdict ?? "none")}</td><td>${blocked?.blockerCount ?? 0}</td></tr>
      <tr><td>Resolved blockers</td><td colspan="3">${comparison.resolvedBlockers.length === 0 ? "none" : comparison.resolvedBlockers.map(escapeHtml).join("<br>")}</td></tr>
      <tr><td>Resolution evidence</td><td colspan="3">${resolutionRows}</td></tr>
      <tr><td>Still shared</td><td colspan="3">${comparison.stillBlocked.length === 0 ? "none" : comparison.stillBlocked.map(escapeHtml).join("<br>")}</td></tr>
      <tr><td>Summary</td><td colspan="3">${escapeHtml(comparison.narrative)}</td></tr>
    </tbody>
  </table>`;
}

function startupTimelineGroupsTable(groups: DashboardStartupTimelineGroup[]): string {
  if (groups.length === 0) {
    return '<div class="empty">No startup operator timeline entries.</div>';
  }

  return groups
    .map((group) => {
      const rows = group.items
        .slice(0, 10)
        .map((item) => {
          const artifacts =
            item.artifacts.length === 0
              ? "none"
              : item.artifacts
                  .map((artifact) => `<code>${escapeHtml(artifact)}</code>`)
                  .join("<br>");

          return `<tr><td><code>${escapeHtml(item.id)}</code><br>${escapeHtml(item.title)}</td><td>${statusCell(item.status)}</td><td>${escapeHtml(item.createdAt ?? "n/a")}</td><td>${escapeHtml(item.detail ?? "none")}<br>${artifacts}</td></tr>`;
        })
        .join("");

      return `<table>
        <thead><tr><th>Timeline: ${escapeHtml(group.title)}</th><th>Status</th><th>Time</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    })
    .join("");
}

function daemonSection(status: DashboardDaemonStatus): string {
  const rows: [string, string][] = status.available
    ? [
        ["Status", "available"],
        ...(status.stale === undefined
          ? []
          : ([
              [
                "Health",
                `${status.stale ? "stale" : "healthy"}${
                  status.ageMs === undefined ? "" : ` age=${status.ageMs}ms`
                }`
              ]
            ] as [string, string][])),
        ["Updated", status.updatedAt ?? "unknown"],
        ["Tick", status.tick === undefined ? "unknown" : String(status.tick)],
        [
          "Last result",
          status.ranTask === true
            ? `${status.taskId ?? "unknown"} ${status.taskStatus ?? "unknown"}`
            : `idle (${status.reason ?? "unknown"})`
        ],
        ...(status.ciRepairStatus === undefined
          ? []
          : ([
              [
                "CI repair",
                [
                  status.ciRepairStatus,
                  status.branchName === undefined
                    ? undefined
                    : `branch=${status.branchName}`,
                  status.pullRequest === undefined
                    ? undefined
                    : `pr=${status.pullRequest}`,
                  status.approvalId === undefined
                    ? undefined
                    : `approval=${status.approvalId}`
                ]
                  .filter((part): part is string => part !== undefined)
                  .join(" ")
              ]
            ] as [string, string][])),
        ...(status.eventId === undefined
          ? []
          : ([["Audit event", status.eventId]] as [string, string][]))
      ]
    : [
        ["Status", "unavailable"],
        ["Reason", status.error ?? "missing_status"]
      ];
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    )
    .join("");

  return `<section><header><h2>Daemon</h2><span class="muted">${daemonSectionLabel(status)}</span></header><table><tbody>${body}</tbody></table></section>`;
}

function daemonSectionLabel(status: DashboardDaemonStatus): string {
  if (!status.available) {
    return "offline";
  }

  return status.stale === true ? "stale" : "heartbeat";
}

function tableSection<T>(
  title: string,
  rows: T[],
  columns: string[],
  mapRow: (row: T) => string[]
): string {
  const body =
    rows.length === 0
      ? `<div class="empty">No ${escapeHtml(title.toLowerCase())}.</div>`
      : `<table>
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows
            .map(
              (row) =>
                `<tr>${mapRow(row)
                  .map((cell) => `<td>${cell}</td>`)
                  .join("")}</tr>`
            )
            .join("\n")}
        </tbody>
      </table>`;

  return `<section><header><h2>${escapeHtml(title)}</h2><span class="muted">${rows.length}</span></header>${body}</section>`;
}

function statusCell(status: string): string {
  return `<span class="status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function riskCell(risk: string): string {
  return `<span class="risk-${escapeHtml(risk)}">${escapeHtml(risk)}</span>`;
}

function rowToRepository(row: RepositoryRow): DashboardRepository {
  return {
    id: row.id,
    alias: row.alias,
    localPath: row.local_path,
    status: row.status,
    ...(row.remote_url === null ? {} : { remoteUrl: row.remote_url })
  };
}

function rowToGoal(row: GoalRow): DashboardGoal {
  const scope = JSON.parse(row.scope_json) as { repositoryAlias?: unknown };
  const repositoryAlias =
    typeof scope.repositoryAlias === "string" ? scope.repositoryAlias : undefined;

  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    status: row.status,
    priority: row.priority,
    ...(repositoryAlias === undefined ? {} : { repositoryAlias }),
    updatedAt: row.updated_at
  };
}

function rowToTask(row: TaskRow): DashboardTask {
  return {
    id: row.id,
    goalId: row.goal_id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    updatedAt: row.updated_at
  };
}

function rowToApproval(row: ApprovalRow): DashboardApproval {
  return {
    id: row.id,
    actionId: row.action_id,
    status: row.status,
    risk: row.risk,
    reason: row.reason,
    updatedAt: row.updated_at
  };
}

function rowToEvent(row: EventRow): DashboardEvent {
  return {
    eventId: row.event_id,
    type: row.type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    createdAt: row.created_at
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

interface RepositoryRow {
  id: string;
  alias: string;
  local_path: string;
  remote_url: string | null;
  status: string;
}

interface GoalRow {
  id: string;
  domain: string;
  title: string;
  status: string;
  priority: string;
  scope_json: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  goal_id: string;
  type: string;
  status: string;
  priority: string;
  updated_at: string;
}

interface ApprovalRow {
  id: string;
  action_id: string;
  status: string;
  risk: string;
  reason: string;
  updated_at: string;
}

interface EventRow {
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  created_at: string;
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

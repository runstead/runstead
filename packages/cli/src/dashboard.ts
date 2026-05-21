import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import { requireRunsteadStateDb } from "./runstead-root.js";
import { getStartupStatus, type StartupStatusResult } from "./startup-status.js";

export interface BuildDashboardOptions {
  cwd?: string;
  outputDir?: string;
  now?: Date;
}

export interface BuildDashboardResult {
  root: string;
  stateDb: string;
  outputDir: string;
  htmlPath: string;
  dataPath: string;
  snapshot: DashboardSnapshot;
  event: RunsteadEvent;
}

export interface DashboardSnapshot {
  generatedAt: string;
  summary: DashboardSummary;
  repositories: DashboardRepository[];
  goals: DashboardGoal[];
  tasks: DashboardTask[];
  approvals: DashboardApproval[];
  events: DashboardEvent[];
  daemon: DashboardDaemonStatus;
  startup: DashboardStartupSnapshot;
}

export interface DashboardSummary {
  repositories: number;
  activeGoals: number;
  queuedTasks: number;
  runningTasks: number;
  failedTasks: number;
  pendingApprovals: number;
}

export interface DashboardRepository {
  id: string;
  alias: string;
  localPath: string;
  status: string;
  remoteUrl?: string;
}

export interface DashboardGoal {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: string;
  repositoryAlias?: string;
  updatedAt: string;
}

export interface DashboardTask {
  id: string;
  goalId: string;
  type: string;
  status: string;
  priority: string;
  updatedAt: string;
}

export interface DashboardApproval {
  id: string;
  actionId: string;
  status: string;
  risk: string;
  reason: string;
  updatedAt: string;
}

export interface DashboardEvent {
  eventId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  createdAt: string;
}

export interface DashboardDaemonStatus {
  available: boolean;
  updatedAt?: string;
  pid?: number;
  tick?: number;
  intervalMs?: number;
  ranTask?: boolean;
  reason?: string;
  taskId?: string;
  taskType?: string;
  taskStatus?: string;
  ciRepairStatus?: string;
  branchName?: string;
  approvalId?: string;
  pullRequest?: string;
  eventId?: string;
  ageMs?: number;
  stale?: boolean;
  error?: string;
}

export interface DashboardStartupSnapshot {
  available: boolean;
  status?: StartupStatusResult;
  latestReportPath?: string;
  error?: string;
}

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
  const database = openRunsteadDatabase(stateDb);

  try {
    const snapshot = {
      ...readDashboardSnapshot(database, generatedAt),
      daemon: await readDashboardDaemonStatus(root, generatedAt),
      startup: await readDashboardStartupStatus({
        cwd,
        root,
        generatedAt
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
    await writeFile(htmlPath, html, "utf8");
    appendEventAndProject(database, { event });

    return {
      root,
      stateDb,
      outputDir,
      htmlPath,
      dataPath,
      snapshot,
      event
    };
  } finally {
    database.close();
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
      available: false
    }
  };
}

async function readDashboardStartupStatus(input: {
  cwd: string;
  root: string;
  generatedAt: string;
}): Promise<DashboardStartupSnapshot> {
  try {
    return {
      available: true,
      status: await getStartupStatus({
        cwd: input.cwd,
        now: new Date(input.generatedAt)
      }),
      ...latestStartupReport(input.root)
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function latestStartupReport(root: string): { latestReportPath?: string } {
  const reportPath = join(root, "reports", "launch-readiness-ai-native-startup.md");

  return { latestReportPath: reportPath };
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
  </style>
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

function startupSection(startup: DashboardStartupSnapshot): string {
  if (!startup.available || startup.status === undefined) {
    return `<section><header><h2>Startup Readiness</h2><span class="muted">unavailable</span></header><div class="empty">${escapeHtml(startup.error ?? "Startup status is not available.")}</div></section>`;
  }

  const status = startup.status;
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

  return `<section>
    <header><h2>Startup Readiness</h2><span class="muted">${escapeHtml(status.currentStage)}</span></header>
    <table><tbody>
      <tr><th>Next action</th><td><code>${escapeHtml(status.nextAction.command)}</code><br>${escapeHtml(status.nextAction.reason)}</td></tr>
      <tr><th>Evidence</th><td>${status.evidence.total} records; sources: ${escapeHtml(sources)}; stale: ${status.evidence.staleSources.length}</td></tr>
      <tr><th>Latest report</th><td><code>${escapeHtml(startup.latestReportPath ?? "none")}</code></td></tr>
    </tbody></table>
    <table>
      <thead><tr><th>Gate</th><th>Status</th><th>Blockers</th><th>Top blocker</th></tr></thead>
      <tbody>${gateRows}</tbody>
    </table>
    ${
      blockerRows.length === 0
        ? '<div class="empty">No startup blockers.</div>'
        : `<table><thead><tr><th>Gate</th><th>Blocker board</th></tr></thead><tbody>${blockerRows.join("")}</tbody></table>`
    }
  </section>`;
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

function dashboardEventPayload(
  snapshot: DashboardSnapshot,
  htmlPath: string,
  dataPath: string
): JsonObject {
  return {
    htmlPath,
    dataPath,
    summary: snapshot.summary,
    daemon: {
      available: snapshot.daemon.available,
      ...(snapshot.daemon.updatedAt === undefined
        ? {}
        : { updatedAt: snapshot.daemon.updatedAt }),
      ...(snapshot.daemon.error === undefined ? {} : { error: snapshot.daemon.error }),
      ...(snapshot.daemon.stale === undefined ? {} : { stale: snapshot.daemon.stale }),
      ...(snapshot.daemon.ageMs === undefined ? {} : { ageMs: snapshot.daemon.ageMs }),
      ...(snapshot.daemon.ciRepairStatus === undefined
        ? {}
        : { ciRepairStatus: snapshot.daemon.ciRepairStatus }),
      ...(snapshot.daemon.branchName === undefined
        ? {}
        : { branchName: snapshot.daemon.branchName }),
      ...(snapshot.daemon.approvalId === undefined
        ? {}
        : { approvalId: snapshot.daemon.approvalId }),
      ...(snapshot.daemon.pullRequest === undefined
        ? {}
        : { pullRequest: snapshot.daemon.pullRequest })
    },
    startup: {
      available: snapshot.startup.available,
      ...(snapshot.startup.status === undefined
        ? {}
        : {
            currentStage: snapshot.startup.status.currentStage,
            nextAction: snapshot.startup.status.nextAction,
            gates: snapshot.startup.status.gates.map((gate) => ({
              stage: gate.stage,
              status: gate.status,
              blockers: gate.blockers.length
            })),
            evidence: {
              total: snapshot.startup.status.evidence.total,
              staleSources: snapshot.startup.status.evidence.staleSources.length,
              sourceKinds: snapshot.startup.status.evidence.sourceKinds
            }
          })
    }
  };
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

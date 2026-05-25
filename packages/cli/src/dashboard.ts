import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRunsteadId, type JsonObject, type RunsteadEvent } from "@runstead/core";
import {
  appendEventAndProject,
  openRunsteadDatabase,
  type RunsteadDatabase
} from "@runstead/state-sqlite";

import { decideApproval } from "./approvals.js";
import { checkPermission } from "./rbac.js";
import { resumeInterruptedTasks } from "./resume.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { addStartupEvidence, type StartupGateStage } from "./startup-evidence.js";
import { runStartupReady } from "./startup-ready.js";
import { getStartupStatus } from "./startup-status.js";
import type {
  BuildDashboardOptions,
  BuildDashboardResult,
  DashboardApproval,
  DashboardDaemonStatus,
  DashboardEvent,
  DashboardGoal,
  DashboardOperatorAction,
  DashboardOperatorApiConfig,
  DashboardOperatorApiSession,
  DashboardOperatorConsole,
  DashboardOperatorRunContext,
  DashboardRepository,
  DashboardSnapshot,
  DashboardStartupAgentPatch,
  DashboardStartupGuidedStep,
  DashboardStartupOperatorCommand,
  DashboardStartupRun,
  DashboardStartupRunComparison,
  DashboardStartupRunSummary,
  DashboardStartupSnapshot,
  DashboardStartupTimelineGroup,
  DashboardSummary,
  DashboardTask,
  ServeDashboardOptions,
  ServeDashboardResult
} from "./dashboard-types.js";
import { runTaskVerifiers } from "./verifier-runner.js";

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

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolveListen();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function serverPort(server: Server): number {
  const address = server.address();

  if (typeof address === "object" && address !== null) {
    return address.port;
  }

  throw new Error("Dashboard server did not expose a TCP port");
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
      body
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

interface DashboardOperatorApiAction {
  kind:
    | "operator_action"
    | "approval_approve"
    | "approval_deny"
    | "run_resume"
    | "verifiers_run"
    | "manual_evidence";
  id: string;
  path: string;
}

class DashboardOperatorApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function dashboardOperatorMutationPath(pathname: string): boolean {
  return (
    /^\/operator-actions\/[^/]+\/run$/.test(pathname) ||
    /^\/approvals\/[^/]+\/(approve|deny)$/.test(pathname) ||
    /^\/runs\/[^/]+\/resume$/.test(pathname) ||
    pathname === "/verifiers/run" ||
    pathname === "/evidence/manual"
  );
}

function dashboardOperatorActionDescriptor(
  pathname: string,
  body: Record<string, unknown>
): DashboardOperatorApiAction {
  const parts = pathname.split("/").map((part) => decodeURIComponent(part));

  if (parts[1] === "operator-actions" && parts[3] === "run") {
    return {
      kind: "operator_action",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (parts[1] === "approvals" && parts[3] === "approve") {
    return {
      kind: "approval_approve",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (parts[1] === "approvals" && parts[3] === "deny") {
    return {
      kind: "approval_deny",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (parts[1] === "runs" && parts[3] === "resume") {
    return {
      kind: "run_resume",
      id: parts[2] ?? "unknown",
      path: pathname
    };
  }

  if (pathname === "/verifiers/run") {
    return {
      kind: "verifiers_run",
      id: stringBodyField(body.taskId) ?? "unknown",
      path: pathname
    };
  }

  return {
    kind: "manual_evidence",
    id: stringBodyField(body.type) ?? "manual_change",
    path: pathname
  };
}

async function executeDashboardOperatorApiAction(input: {
  build: BuildDashboardResult;
  actor: string;
  action: DashboardOperatorApiAction;
  body: Record<string, unknown>;
}): Promise<JsonObject> {
  if (input.action.kind === "approval_approve") {
    return approveDashboardApproval({
      cwd: input.build.cwd,
      actor: input.actor,
      approvalId: input.action.id
    });
  }

  if (input.action.kind === "approval_deny") {
    return denyDashboardApproval({
      cwd: input.build.cwd,
      actor: input.actor,
      approvalId: input.action.id
    });
  }

  if (input.action.kind === "run_resume") {
    return resumeDashboardStartupRun({
      cwd: input.build.cwd,
      actor: input.actor,
      runId: input.action.id
    });
  }

  if (input.action.kind === "verifiers_run") {
    return runDashboardVerifiers({
      cwd: input.build.cwd,
      actor: input.actor,
      body: input.body
    });
  }

  if (input.action.kind === "manual_evidence") {
    return recordDashboardManualEvidence({
      cwd: input.build.cwd,
      actor: input.actor,
      body: input.body
    });
  }

  return runDashboardOperatorAction({
    build: input.build,
    actor: input.actor,
    actionId: input.action.id
  });
}

async function approveDashboardApproval(input: {
  cwd: string;
  actor: string;
  approvalId: string;
}): Promise<JsonObject> {
  const result = await decideApproval({
    cwd: input.cwd,
    id: input.approvalId,
    decision: "approved",
    decidedBy: input.actor
  });

  return {
    approvalId: result.approval.id,
    status: result.approval.status,
    previousStatus: result.previousStatus,
    eventId: result.event.eventId
  };
}

async function denyDashboardApproval(input: {
  cwd: string;
  actor: string;
  approvalId: string;
}): Promise<JsonObject> {
  const result = await decideApproval({
    cwd: input.cwd,
    id: input.approvalId,
    decision: "denied",
    decidedBy: input.actor
  });

  return {
    approvalId: result.approval.id,
    status: result.approval.status,
    previousStatus: result.previousStatus,
    eventId: result.event.eventId
  };
}

async function resumeDashboardStartupRun(input: {
  cwd: string;
  actor: string;
  runId: string;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "task.run",
    action: "resume startup readiness"
  });

  const result = await runStartupReady({
    cwd: input.cwd,
    resumeRunId: input.runId
  });

  return {
    runId: result.run.id,
    status: result.run.status,
    verdict: result.run.verdict
  };
}

async function runDashboardVerifiers(input: {
  cwd: string;
  actor: string;
  body: Record<string, unknown>;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "task.run",
    action: "run verifiers"
  });

  const taskId = requiredStringBodyField(input.body.taskId, "taskId");
  const mode = stringBodyField(input.body.mode);
  const result = await runTaskVerifiers({
    cwd: input.cwd,
    taskId,
    mode: mode === "finalize_task" ? "finalize_task" : "evidence_only"
  });

  return {
    taskId: result.task.id,
    taskStatus: result.task.status,
    verifierCount: result.commandResults.length,
    evidenceIds: result.commandResults
      .map((item) => item.evidenceId)
      .filter((id): id is string => id !== undefined)
  };
}

async function recordDashboardManualEvidence(input: {
  cwd: string;
  actor: string;
  body: Record<string, unknown>;
}): Promise<JsonObject> {
  await requireDashboardOperatorPermission({
    cwd: input.cwd,
    actor: input.actor,
    permission: "evidence.write",
    action: "record manual evidence"
  });

  const type = stringBodyField(input.body.type) ?? "manual_change";
  const summary = requiredStringBodyField(input.body.summary, "summary");
  const gate = optionalStartupGateStage(input.body.gate);
  const result = await addStartupEvidence({
    cwd: input.cwd,
    type,
    summary,
    sourceRefs: stringArrayBodyField(input.body.sourceRefs),
    ...(stringBodyField(input.body.content) === undefined
      ? {}
      : { content: stringBodyField(input.body.content) ?? "" }),
    ...(stringBodyField(input.body.goalId) === undefined
      ? {}
      : { goalId: stringBodyField(input.body.goalId) ?? "" }),
    ...(gate === undefined ? {} : { gate }),
    ...(stringBodyField(input.body.blocker) === undefined
      ? {}
      : { blocker: stringBodyField(input.body.blocker) ?? "" })
  });

  return {
    evidenceId: result.evidence.id,
    evidenceType: result.evidence.type,
    artifactPath: result.artifactPath
  };
}

async function runDashboardOperatorAction(input: {
  build: BuildDashboardResult;
  actor: string;
  actionId: string;
}): Promise<JsonObject> {
  const action = input.build.snapshot.operator.actions.find(
    (item) => item.id === input.actionId
  );

  if (action === undefined) {
    throw new DashboardOperatorApiHttpError(
      404,
      "operator_action_not_found",
      `Operator action not found: ${input.actionId}`
    );
  }

  const approvalId = approvalIdFromOperatorAction(action, input.build.snapshot);

  if (approvalId !== undefined) {
    const approval = await approveDashboardApproval({
      cwd: input.build.cwd,
      actor: input.actor,
      approvalId
    });
    const resumed = await resumeInterruptedTasks({
      cwd: input.build.cwd
    });

    return {
      operatorActionId: action.id,
      approval,
      requeuedTaskIds: resumed.requeuedTasks.map((item) => item.task.id),
      failedTaskIds: resumed.failedTasks.map((item) => item.task.id)
    };
  }

  const runId = shellOptionValue(action.command, "--resume");

  if (runId !== undefined) {
    const resumed = await resumeDashboardStartupRun({
      cwd: input.build.cwd,
      actor: input.actor,
      runId
    });

    return {
      operatorActionId: action.id,
      resumed
    };
  }

  if (/\brunstead\s+dashboard\s+build\b/.test(action.command)) {
    await requireDashboardOperatorPermission({
      cwd: input.build.cwd,
      actor: input.actor,
      permission: "dashboard.manage",
      action: "rebuild dashboard"
    });

    const rebuilt = await buildDashboard({
      cwd: input.build.cwd,
      outputDir: input.build.outputDir
    });

    return {
      operatorActionId: action.id,
      dashboardEventId: rebuilt.event.eventId,
      htmlPath: rebuilt.htmlPath,
      dataPath: rebuilt.dataPath
    };
  }

  throw new DashboardOperatorApiHttpError(
    422,
    "unsupported_operator_action",
    `Operator action ${action.id} is not executable by the local API.`
  );
}

function approvalIdFromOperatorAction(
  action: DashboardOperatorAction,
  snapshot: DashboardSnapshot
): string | undefined {
  if (action.id.startsWith("approval-")) {
    return action.id.slice("approval-".length);
  }

  if (action.id === "daemon-approval-resume") {
    return snapshot.daemon.approvalId ?? approvalIdFromCommand(action.command);
  }

  return approvalIdFromCommand(action.command);
}

function approvalIdFromCommand(command: string): string | undefined {
  const match = /\bapproval\s+approve-and-resume\s+("[^"]+"|'[^']+'|\S+)/.exec(command);

  return match?.[1] === undefined ? undefined : unquoteShellToken(match[1]);
}

function shellOptionValue(command: string, option: string): string | undefined {
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s+("[^"]+"|'[^']+'|\\S+)`).exec(command);

  return match?.[1] === undefined ? undefined : unquoteShellToken(match[1]);
}

function unquoteShellToken(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

async function requireDashboardOperatorPermission(input: {
  cwd: string;
  actor: string;
  permission: string;
  action: string;
}): Promise<void> {
  const permission = await checkPermission({
    cwd: input.cwd,
    subject: input.actor,
    permission: input.permission
  });

  if (permission.decision !== "allow") {
    throw new DashboardOperatorApiHttpError(
      403,
      "rbac_denied",
      `Subject ${input.actor} cannot ${input.action}: ${permission.reason}`
    );
  }
}

function recordDashboardOperatorApiEvent(input: {
  build: BuildDashboardResult;
  actor: string;
  action: DashboardOperatorApiAction;
  status: "completed" | "failed";
  result?: JsonObject;
  error?: string;
}): void {
  const createdAt = new Date().toISOString();
  const event: RunsteadEvent = {
    eventId: createRunsteadId("evt"),
    type: `dashboard.operator_action.${input.status}`,
    aggregateType: "dashboard_operator_action",
    aggregateId: input.action.id,
    payload: {
      actor: input.actor,
      action: input.action,
      status: input.status,
      ...(input.result === undefined ? {} : { result: input.result }),
      ...(input.error === undefined ? {} : { error: input.error })
    },
    createdAt
  };
  const database = openRunsteadDatabase(input.build.stateDb);

  try {
    appendEventAndProject(database, { event });
  } finally {
    database.close();
  }
}

function dashboardOperatorApiAuthError(
  request: IncomingMessage,
  operatorApi: DashboardOperatorApiSession
): JsonObject | undefined {
  if (!localRemoteAddress(request.socket.remoteAddress)) {
    return {
      error: "non_local_request",
      message: "Operator API only accepts local requests."
    };
  }

  if (!sameOriginRequest(request)) {
    return {
      error: "origin_denied",
      message: "Operator API rejected a cross-origin request."
    };
  }

  const sessionToken =
    headerValue(request.headers["x-runstead-session-token"]) ??
    bearerToken(headerValue(request.headers.authorization));

  if (sessionToken !== operatorApi.sessionToken) {
    return {
      error: "invalid_session",
      message: "Operator API session token is missing or invalid."
    };
  }

  if (headerValue(request.headers["x-runstead-csrf-token"]) !== operatorApi.csrfToken) {
    return {
      error: "invalid_csrf",
      message: "Operator API CSRF token is missing or invalid."
    };
  }

  return undefined;
}

async function readJsonRequestBody(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (raw.length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("JSON request body must be an object.");
  }

  return parsed;
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  body: JsonObject,
  headers: Record<string, string> = {}
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function dashboardOperatorApiError(error: unknown): DashboardOperatorApiHttpError {
  if (error instanceof DashboardOperatorApiHttpError) {
    return error;
  }

  return new DashboardOperatorApiHttpError(
    500,
    "operator_action_failed",
    error instanceof Error ? error.message : String(error)
  );
}

function requiredStringBodyField(value: unknown, field: string): string {
  const parsed = stringBodyField(value);

  if (parsed === undefined) {
    throw new DashboardOperatorApiHttpError(
      400,
      "missing_field",
      `Request body field ${field} is required.`
    );
  }

  return parsed;
}

function stringBodyField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function stringArrayBodyField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function optionalStartupGateStage(value: unknown): StartupGateStage | undefined {
  const stage = stringBodyField(value);

  if (stage === undefined) {
    return undefined;
  }

  if (stage === "idea" || stage === "mvp" || stage === "launch" || stage === "scale") {
    return stage;
  }

  throw new DashboardOperatorApiHttpError(
    400,
    "invalid_gate",
    `Unsupported startup gate stage: ${stage}`
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function bearerToken(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value);

  return match?.[1];
}

function sameOriginRequest(request: IncomingMessage): boolean {
  const origin = headerValue(request.headers.origin);

  if (origin === undefined) {
    return true;
  }

  const host = headerValue(request.headers.host);

  if (host === undefined) {
    return false;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function localBindHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function localRemoteAddress(address: string | undefined): boolean {
  return (
    address === undefined ||
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function urlHost(host: string): string {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }

  return host.includes(":") ? `[${host}]` : host;
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

    return {
      available: true,
      status,
      ...report,
      ...(latestRun === undefined ? {} : { latestRun }),
      ...dashboardStartupRunComparison(runs),
      timelineGroups: dashboardStartupTimelineGroups({
        database: input.database,
        ...(latestRun === undefined ? {} : { latestRun }),
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

        return {
          phase: phaseId,
          title: stringField(phase.title) ?? phaseId,
          status: stringField(phase.status) ?? "unknown",
          evidence: stringArrayField(phase.evidenceIds).length,
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

  return {
    runComparison: {
      ...(latestCompleted === undefined
        ? {}
        : { latestCompleted: dashboardStartupRunSummary(latestCompleted) }),
      ...(latestBlocked === undefined
        ? {}
        : { latestBlocked: dashboardStartupRunSummary(latestBlocked) }),
      resolvedBlockers,
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
  latestReportPath?: string;
}): DashboardStartupTimelineGroup[] {
  return [
    dashboardPhaseTimelineGroup(input.latestRun),
    dashboardWorkerRunTimelineGroup(input.database),
    dashboardModelRequestTimelineGroup(input.database),
    dashboardToolCallTimelineGroup(input.database),
    dashboardApprovalTimelineGroup(input.database),
    dashboardEvidenceTimelineGroup(input.database),
    dashboardReportTimelineGroup(input.latestRun, input.latestReportPath)
  ].filter((group): group is DashboardStartupTimelineGroup => group.items.length > 0);
}

function dashboardPhaseTimelineGroup(
  run: DashboardStartupRun | undefined
): DashboardStartupTimelineGroup {
  return {
    group: "phases",
    title: "Phases",
    items:
      run?.timeline.map((item) => {
        const detail = item.blockers[0] ?? item.nextAction;

        return {
          id: item.phase,
          title: item.title,
          status: item.status,
          ...(detail === undefined ? {} : { detail }),
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

function buildDashboardOperatorConsole(input: {
  cwd: string;
  daemon: DashboardDaemonStatus;
  startup: DashboardStartupSnapshot;
  approvals: DashboardApproval[];
}): DashboardOperatorConsole {
  const actions: DashboardOperatorAction[] = [];
  const seen = new Set<string>();
  const addAction = (action: DashboardOperatorAction): void => {
    const key = `${action.source}:${action.command}`;

    if (action.command.trim().length === 0 || seen.has(key)) {
      return;
    }

    seen.add(key);
    actions.push(action);
  };

  if (input.daemon.approvalId !== undefined) {
    addAction({
      id: "daemon-approval-resume",
      title: "Approve and resume daemon task",
      command: `runstead approval approve-and-resume ${shellQuote(input.daemon.approvalId)} --cwd ${shellQuote(input.cwd)}`,
      reason:
        input.daemon.ciRepairStatus === undefined
          ? "A daemon task is waiting on approval."
          : `Daemon CI repair is ${input.daemon.ciRepairStatus}.`,
      source: "daemon_approval",
      status: "blocked"
    });
  }

  for (const approval of input.approvals.filter((item) => item.status === "pending")) {
    addAction({
      id: `approval-${approval.id}`,
      title: `Approve ${approval.risk}-risk request`,
      command: `runstead approval approve-and-resume ${shellQuote(approval.id)} --cwd ${shellQuote(input.cwd)}`,
      reason: approval.reason,
      source: "daemon_approval",
      status: "blocked"
    });
  }

  if (input.startup.status !== undefined) {
    const activeBlockers =
      input.startup.status.readiness?.blockers ??
      input.startup.status.gates.flatMap((gate) => gate.blockers);

    addAction({
      id: "startup-next-action",
      title: "Run startup next action",
      command: input.startup.status.nextAction.command,
      reason: input.startup.status.nextAction.reason,
      source: "startup_next_action",
      status: activeBlockers.length === 0 ? "ready" : "blocked"
    });
  }

  const run = input.startup.latestRun;

  for (const [index, item] of (run?.operatorCommands ?? []).entries()) {
    addAction({
      id: `startup-run-command-${index + 1}`,
      title: item.title,
      command: item.command,
      reason: item.when,
      source: "startup_run_command",
      status:
        item.kind === "recover"
          ? "ready"
          : item.kind === "resume" && run?.status !== "completed"
            ? "blocked"
            : "info"
    });
  }

  for (const [index, step] of (run?.guidedFlow ?? []).entries()) {
    if (step.command === undefined) {
      continue;
    }

    addAction({
      id: `guided-flow-${index + 1}`,
      title: step.title,
      command: step.command,
      reason: step.why,
      source: "guided_flow",
      status: step.status === "blocked" ? "blocked" : "ready"
    });
  }

  const recommendedAction =
    actions.find((action) => action.status === "blocked") ?? actions[0];
  const currentRun =
    run === undefined
      ? undefined
      : dashboardOperatorRunContext({
          cwd: input.cwd,
          run
        });
  const pendingApprovals = input.approvals
    .filter((item) => item.status === "pending")
    .map((approval) => ({
      id: approval.id,
      risk: approval.risk,
      reason: approval.reason,
      command: `runstead approval approve-and-resume ${shellQuote(approval.id)} --cwd ${shellQuote(input.cwd)}`
    }));
  const blockerCount =
    input.startup.status?.gates.reduce(
      (count, gate) => count + gate.blockers.length,
      0
    ) ??
    run?.blockers.length ??
    0;

  return {
    actions,
    ...(recommendedAction === undefined ? {} : { recommendedAction }),
    ...(currentRun === undefined ? {} : { currentRun }),
    pendingApprovals,
    blockerCount,
    staleEvidenceCount: input.startup.staleEvidence.length,
    ...(recommendedAction === undefined
      ? {}
      : { recommendedCommand: recommendedAction.command })
  };
}

function dashboardOperatorRunContext(input: {
  cwd: string;
  run: DashboardStartupRun;
}): DashboardOperatorRunContext {
  const resumeCommand = input.run.operatorCommands.find(
    (command) => command.kind === "resume"
  )?.command;

  return {
    id: input.run.id,
    stage: input.run.stage,
    target: input.run.target,
    status: input.run.status,
    verdict: input.run.verdict,
    blockers: input.run.blockers,
    ...(resumeCommand === undefined
      ? {
          resumeCommand: `runstead startup ready --cwd ${shellQuote(input.cwd)} --resume ${shellQuote(input.run.id)}`
        }
      : { resumeCommand })
  };
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
    .operator-api input:focus-visible {
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
    .operator-api input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      min-height: 32px;
      padding: 5px 8px;
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
    return `<section><header><h2>Operator Console</h2><span class="muted">0 actions</span></header>${operatorConsoleContextTable(operator, pendingApprovals)}<div class="empty">No operator actions are available.</div></section>`;
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
    <div class="operator-api">
      <label><span class="muted">Session token</span><input type="password" autocomplete="off" data-operator-session></label>
      <label><span class="muted">CSRF token</span><input type="password" autocomplete="off" data-operator-csrf></label>
      <div class="operator-result" data-operator-result></div>
    </div>
  </section>`;
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

function dashboardEventPayload(
  snapshot: DashboardSnapshot,
  htmlPath: string,
  dataPath: string
): JsonObject {
  const startupDetails =
    snapshot.startup.status === undefined
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
          },
          ...(snapshot.startup.latestRun === undefined
            ? {}
            : {
                latestRun: {
                  id: snapshot.startup.latestRun.id,
                  target: snapshot.startup.latestRun.target,
                  verdict: snapshot.startup.latestRun.verdict,
                  status: snapshot.startup.latestRun.status,
                  timeline: snapshot.startup.latestRun.timeline.length,
                  guidedFlow: snapshot.startup.latestRun.guidedFlow.length,
                  operatorCommands: snapshot.startup.latestRun.operatorCommands.length,
                  uiSmokeArtifacts: snapshot.startup.latestRun.uiSmokeArtifacts.length
                }
              }),
          staleEvidence: snapshot.startup.staleEvidence.length,
          ...(snapshot.startup.agentPatch === undefined
            ? {}
            : {
                agentPatch: {
                  taskId: snapshot.startup.agentPatch.taskId,
                  status: snapshot.startup.agentPatch.status,
                  filesTouched: snapshot.startup.agentPatch.filesTouched.length
                }
              }),
          ...(snapshot.startup.runComparison === undefined
            ? {}
            : {
                runComparison: {
                  latestCompleted:
                    snapshot.startup.runComparison.latestCompleted?.id ?? null,
                  latestBlocked:
                    snapshot.startup.runComparison.latestBlocked?.id ?? null,
                  resolvedBlockers:
                    snapshot.startup.runComparison.resolvedBlockers.length,
                  stillBlocked: snapshot.startup.runComparison.stillBlocked.length
                }
              }),
          timelineGroups: snapshot.startup.timelineGroups.map((group) => ({
            group: group.group,
            items: group.items.length
          }))
        };

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
      ...startupDetails
    },
    operator: {
      actions: snapshot.operator.actions.length,
      ...(snapshot.operator.recommendedAction === undefined
        ? {}
        : {
            recommendedAction: {
              id: snapshot.operator.recommendedAction.id,
              source: snapshot.operator.recommendedAction.source,
              status: snapshot.operator.recommendedAction.status
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

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
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

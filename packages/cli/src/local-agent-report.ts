import { resolve } from "node:path";

import type { Goal, JsonObject, Task } from "@runstead/core";
import { openRunsteadDatabase, type RunsteadDatabase } from "@runstead/state-sqlite";

import { showGoal } from "./goals.js";
import {
  diagnoseLocalAgentTask,
  formatLocalAgentDiagnostics
} from "./local-agent-diagnostics.js";
import { localAgentTaskMode, localAgentTaskWorker } from "./local-agent-task-input.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { showTask } from "./tasks.js";

const LOCAL_AGENT_TASK_TYPE = "local_agent_task";

export interface LocalAgentAuditCount {
  name: string;
  status: string;
  count: number;
}

export interface LocalAgentPolicyDecisionCount {
  decision: string;
  risk: string;
  count: number;
}

export interface LocalAgentAuditSummary {
  workerRuns: LocalAgentAuditCount[];
  toolCalls: LocalAgentAuditCount[];
  policyDecisions: LocalAgentPolicyDecisionCount[];
  approvals: LocalAgentAuditCount[];
}

export interface LocalAgentTaskReport {
  cwd: string;
  task: Task;
  goal: Goal;
  audit: LocalAgentAuditSummary;
  toolCalls: LocalAgentReportToolCall[];
}

export interface LocalAgentReportToolCall {
  id: string;
  actionType: string;
  status: string;
  policyDecisionId?: string;
  resource?: string;
  summary?: string;
  failureKind?: LocalAgentToolFailureKind;
  recoverable?: boolean;
  failureExplanation?: string;
}

export type LocalAgentToolFailureKind =
  | "approval_required"
  | "policy_denied"
  | "harmless_patch_mismatch_retry"
  | "missing_file"
  | "tool_runtime_error"
  | "unknown";

export async function loadLocalAgentTaskReport(options: {
  cwd?: string;
  taskId: string;
}): Promise<LocalAgentTaskReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = await requireRunsteadStateDb(cwd);
  const task = showTask({ cwd, id: options.taskId }).task;

  if (!isLocalAgentTask(task)) {
    throw new Error(`Task ${options.taskId} is not a local agent task`);
  }

  const goal = showGoal({ cwd, id: task.goalId }).goal;
  const database = openRunsteadDatabase(state.stateDb);

  try {
    return {
      cwd,
      task,
      goal,
      audit: summarizeLocalAgentAudit(database, task.id),
      toolCalls: readLocalAgentReportToolCalls(database, task.id)
    };
  } finally {
    database.close();
  }
}

export function formatLocalAgentTaskReport(report: LocalAgentTaskReport): string {
  const sections = localAgentReportSections(report);

  return [
    "Runstead agent report",
    `Task: ${report.task.id}`,
    `Goal: ${report.goal.id} ${report.goal.title}`,
    `Status: ${report.task.status}`,
    `Worker: ${localAgentTaskWorker(report.task)}`,
    `Mode: ${localAgentTaskMode(report.task)}`,
    ...(sections.model.provider === undefined
      ? []
      : [`Provider: ${sections.model.provider}`]),
    ...(sections.model.model === undefined ? [] : [`Model: ${sections.model.model}`]),
    ...(sections.model.modelSource === undefined
      ? []
      : [`Model source: ${sections.model.modelSource}`]),
    ...formatWrappedWorkerTaskReportLines(sections),
    ...(sections.checkpoint === undefined
      ? []
      : [`Checkpoint: ${sections.checkpoint}`]),
    ...formatOutputWarnings(report.task),
    ...formatLocalAgentDiagnostics(diagnoseLocalAgentTask(report.task)),
    ...(sections.model.summary === undefined
      ? []
      : ["Model summary:", `  ${sections.model.summary}`]),
    "File/tool activity:",
    ...formatReportToolCalls(sections.fileActivity),
    "Verifier evidence:",
    ...formatReportVerifiers(sections.verifiers),
    "Failed tool calls:",
    ...formatReportToolCalls(sections.failedToolCalls),
    ...formatLocalAgentAuditSummary(report.audit)
  ].join("\n");
}

export function formatLocalAgentTaskReportJson(report: LocalAgentTaskReport): string {
  return `${JSON.stringify(localAgentReportSections(report), null, 2)}\n`;
}

export function formatLocalAgentTaskReportMarkdown(
  report: LocalAgentTaskReport
): string {
  const sections = localAgentReportSections(report);

  return [
    `# Runstead agent report: ${report.task.id}`,
    "",
    `- Status: ${report.task.status}`,
    `- Goal: ${report.goal.id} ${report.goal.title}`,
    `- Worker: ${localAgentTaskWorker(report.task)}`,
    `- Mode: ${localAgentTaskMode(report.task)}`,
    ...(sections.model.provider === undefined
      ? []
      : [`- Provider: ${sections.model.provider}`]),
    ...(sections.model.model === undefined ? [] : [`- Model: ${sections.model.model}`]),
    ...(sections.model.modelSource === undefined
      ? []
      : [`- Model source: ${sections.model.modelSource}`]),
    ...formatWrappedWorkerTaskReportLines(sections).map((line) => `- ${line}`),
    ...(sections.checkpoint === undefined
      ? []
      : [`- Checkpoint: ${sections.checkpoint}`]),
    "",
    "## Model Summary",
    "",
    sections.model.summary ?? "None recorded.",
    "",
    "## File And Tool Activity",
    "",
    ...markdownToolCalls(sections.fileActivity),
    "",
    "## Verifier Evidence",
    "",
    ...markdownVerifiers(sections.verifiers),
    "",
    "## Failed Tool Calls",
    "",
    ...markdownToolCalls(sections.failedToolCalls),
    "",
    "## Policy And Approval",
    "",
    ...formatLocalAgentAuditSummary(report.audit).map((line) => `- ${line.trim()}`)
  ].join("\n");
}

function localAgentReportSections(report: LocalAgentTaskReport) {
  return {
    task: {
      id: report.task.id,
      status: report.task.status,
      goalId: report.goal.id,
      worker: localAgentTaskWorker(report.task),
      mode: localAgentTaskMode(report.task)
    },
    model: {
      provider: stringOutput(report.task.output ?? {}, "modelProvider") || undefined,
      model: stringOutput(report.task.output ?? {}, "model") || undefined,
      modelSource: stringOutput(report.task.output ?? {}, "modelSource") || undefined,
      status: stringOutput(report.task.output ?? {}, "status") || undefined,
      summary: stringOutput(report.task.output ?? {}, "summary") || undefined,
      toolCalls: numberOutput(report.task.output ?? {}, "toolCalls"),
      failedToolCalls: numberOutput(report.task.output ?? {}, "failedToolCalls")
    },
    workerRuntime: {
      command: stringOutput(report.task.output ?? {}, "command") || undefined,
      governance: recordOutput(report.task.output ?? {}, "governance"),
      outputValidation: recordOutput(report.task.output ?? {}, "outputValidation"),
      stdoutBytes: numberOutput(report.task.output ?? {}, "stdoutBytes"),
      stderrBytes: numberOutput(report.task.output ?? {}, "stderrBytes")
    },
    fileActivity: report.toolCalls.filter((call) =>
      [
        "worker.native.start",
        "worker.external.start",
        "filesystem.read",
        "filesystem.write",
        "filesystem.patch",
        "git.status",
        "git.diff",
        "git.log",
        "git.show",
        "git.diff.summary",
        "shell.exec",
        "verifier.run",
        "evidence.read",
        "workspace.facts.read"
      ].includes(call.actionType)
    ),
    verifiers: verifierReportRows(report.task.output ?? {}),
    failedToolCalls: report.toolCalls.filter((call) => call.status !== "completed"),
    policy: report.audit.policyDecisions,
    approvals: report.audit.approvals,
    checkpoint: stringOutput(report.task.output ?? {}, "checkpointId") || undefined,
    audit: report.audit
  };
}

function verifierReportRows(output: JsonObject): {
  verifier: string;
  exitCode?: number | string | null;
  timedOut?: boolean;
  evidenceId?: string;
}[] {
  const verifiers = output.verifiers;

  return Array.isArray(verifiers)
    ? verifiers.filter(isVerifierReportRow).map((row) => ({
        verifier: row.verifier,
        ...(row.exitCode === undefined ? {} : { exitCode: row.exitCode }),
        ...(row.timedOut === undefined ? {} : { timedOut: row.timedOut }),
        ...(row.evidenceId === undefined ? {} : { evidenceId: row.evidenceId })
      }))
    : [];
}

function formatReportToolCalls(calls: LocalAgentReportToolCall[]): string[] {
  return calls.length === 0
    ? ["  none"]
    : calls.map(
        (call) =>
          `  ${call.actionType} ${call.status}${call.resource === undefined ? "" : ` ${call.resource}`}${formatToolCallInlineSummary(call)}`
      );
}

function formatToolCallInlineSummary(call: LocalAgentReportToolCall): string {
  const summary = call.summary === undefined ? "" : ` summary=${call.summary}`;
  const failure =
    call.failureKind === undefined
      ? ""
      : ` failure=${call.failureKind} recoverable=${call.recoverable === true ? "yes" : "no"} explanation=${call.failureExplanation ?? "none"}`;

  return `${summary}${failure}`;
}

function formatReportVerifiers(
  verifiers: ReturnType<typeof verifierReportRows>
): string[] {
  return verifiers.length === 0
    ? ["  none"]
    : verifiers.map(
        (verifier) =>
          `  ${verifier.verifier}: exit=${verifier.exitCode ?? "unknown"} evidence=${verifier.evidenceId ?? "none"}`
      );
}

function formatWrappedWorkerTaskReportLines(
  sections: ReturnType<typeof localAgentReportSections>
): string[] {
  const governance = sections.workerRuntime.governance;

  if (sections.workerRuntime.command === undefined && governance === undefined) {
    return [];
  }

  const outputValidation = sections.workerRuntime.outputValidation;
  const outputValid =
    outputValidation === undefined
      ? "unknown"
      : outputValidation.valid === true
        ? "yes"
        : "no";
  const hardProxy =
    governance === undefined
      ? "unknown"
      : governance.hardProxyToolCalls === true
        ? "yes"
        : "no";

  return [
    "Worker runtime:",
    ...(sections.workerRuntime.command === undefined
      ? []
      : [`  command: ${sections.workerRuntime.command}`]),
    `  boundary: ${stringRecordValue(governance, "boundary") ?? "unknown"}`,
    `  governance level: ${stringRecordValue(governance, "level") ?? "unknown"}`,
    `  hard-proxied tool calls: ${hardProxy}`,
    ...(sections.workerRuntime.outputValidation === undefined
      ? []
      : [`  output valid: ${outputValid}`]),
    ...(sections.workerRuntime.stdoutBytes === undefined
      ? []
      : [`  stdout bytes: ${sections.workerRuntime.stdoutBytes}`]),
    ...(sections.workerRuntime.stderrBytes === undefined
      ? []
      : [`  stderr bytes: ${sections.workerRuntime.stderrBytes}`])
  ];
}

function markdownToolCalls(calls: LocalAgentReportToolCall[]): string[] {
  return calls.length === 0
    ? ["None recorded."]
    : calls.map(
        (call) =>
          `- ${call.actionType} ${call.status}${call.resource === undefined ? "" : ` (${call.resource})`}${formatToolCallInlineSummary(call)}`
      );
}

function markdownVerifiers(verifiers: ReturnType<typeof verifierReportRows>): string[] {
  return verifiers.length === 0
    ? ["None recorded."]
    : verifiers.map(
        (verifier) =>
          `- ${verifier.verifier}: exit=${verifier.exitCode ?? "unknown"}, evidence=${verifier.evidenceId ?? "none"}`
      );
}

export function summarizeLocalAgentAudit(
  database: RunsteadDatabase,
  taskId: string
): LocalAgentAuditSummary {
  const workerRuns = readAuditCounts(
    database,
    `
      SELECT worker_type AS name, status, COUNT(*) AS count
      FROM worker_runs
      WHERE task_id = ?
      GROUP BY worker_type, status
      ORDER BY worker_type, status
    `,
    taskId
  );
  const toolCalls = readAuditCounts(
    database,
    `
      SELECT action_type AS name, status, COUNT(*) AS count
      FROM tool_calls
      WHERE task_id = ?
      GROUP BY action_type, status
      ORDER BY action_type, status
    `,
    taskId
  );
  const policyDecisions = readPolicyDecisionCounts(
    database,
    `
      SELECT pd.decision, pd.risk, COUNT(*) AS count
      FROM policy_decisions pd
      JOIN tool_calls tc ON tc.policy_decision_id = pd.id
      WHERE tc.task_id = ?
      GROUP BY pd.decision, pd.risk
      ORDER BY pd.decision, pd.risk
    `,
    taskId
  );
  const approvals = readAuditCounts(
    database,
    `
      SELECT a.status AS name, a.risk AS status, COUNT(*) AS count
      FROM approvals a
      JOIN policy_decisions pd ON pd.id = a.policy_decision_id
      JOIN tool_calls tc ON tc.policy_decision_id = pd.id
      WHERE tc.task_id = ?
      GROUP BY a.status, a.risk
      ORDER BY a.status, a.risk
    `,
    taskId
  );

  return {
    workerRuns,
    toolCalls,
    policyDecisions,
    approvals
  };
}

function readLocalAgentReportToolCalls(
  database: RunsteadDatabase,
  taskId: string
): LocalAgentReportToolCall[] {
  return (
    database
      .prepare(
        `
          SELECT id, action_type, status, policy_decision_id, input_json, output_json
          FROM tool_calls
          WHERE task_id = ?
          ORDER BY started_at, id
        `
      )
      .all(taskId) as unknown[]
  ).map((row) => {
    const record = row as Record<string, unknown>;
    const input = parseJsonObject(record.input_json);
    const output = parseJsonObject(record.output_json);

    return {
      id: String(record.id),
      actionType: String(record.action_type),
      status: String(record.status),
      ...(typeof record.policy_decision_id === "string"
        ? { policyDecisionId: record.policy_decision_id }
        : {}),
      ...toolCallResource(input),
      ...toolCallSummary(output),
      ...toolCallFailureInsight({
        actionType: String(record.action_type),
        status: String(record.status),
        output
      })
    };
  });
}

function readAuditCounts(
  database: RunsteadDatabase,
  sql: string,
  taskId: string
): LocalAgentAuditCount[] {
  return (database.prepare(sql).all(taskId) as unknown[]).map((row) => {
    const record = row as Record<string, unknown>;

    return {
      name: String(record.name),
      status: String(record.status),
      count: Number(record.count)
    };
  });
}

function readPolicyDecisionCounts(
  database: RunsteadDatabase,
  sql: string,
  taskId: string
): LocalAgentPolicyDecisionCount[] {
  return (database.prepare(sql).all(taskId) as unknown[]).map((row) => {
    const record = row as Record<string, unknown>;

    return {
      decision: String(record.decision),
      risk: String(record.risk),
      count: Number(record.count)
    };
  });
}

export function formatLocalAgentAuditSummary(audit: LocalAgentAuditSummary): string[] {
  return [
    "Audit:",
    ...formatAuditCountGroup("  worker_runs", audit.workerRuns),
    ...formatAuditCountGroup("  tool_calls", audit.toolCalls),
    ...formatPolicyDecisionCounts(audit.policyDecisions),
    ...formatAuditCountGroup("  approvals", audit.approvals)
  ];
}

function formatAuditCountGroup(label: string, rows: LocalAgentAuditCount[]): string[] {
  return rows.length === 0
    ? [`${label}: none`]
    : rows.map((row) => `${label}: ${row.name} ${row.status} x${row.count}`);
}

function formatPolicyDecisionCounts(rows: LocalAgentPolicyDecisionCount[]): string[] {
  return rows.length === 0
    ? ["  policy_decisions: none"]
    : rows.map(
        (row) => `  policy_decisions: ${row.decision} ${row.risk} x${row.count}`
      );
}

function formatOutputWarnings(task: Task): string[] {
  const warnings = task.output?.warnings;

  return Array.isArray(warnings)
    ? formatLocalAgentWarnings(
        warnings.filter((warning): warning is string => typeof warning === "string")
      )
    : [];
}

export function formatLocalAgentWarnings(warnings: string[] | undefined): string[] {
  return warnings === undefined || warnings.length === 0
    ? []
    : ["Warnings:", ...warnings.map((warning) => `  ${warning}`)];
}

function stringOutput(output: JsonObject, key: string): string {
  const value = output[key];

  return typeof value === "string" ? value : "";
}

function numberOutput(output: JsonObject, key: string): number | undefined {
  const value = output[key];

  return typeof value === "number" ? value : undefined;
}

function recordOutput(output: JsonObject, key: string): JsonObject | undefined {
  const value = output[key];

  return isRecord(value) ? value : undefined;
}

function stringRecordValue(
  record: JsonObject | undefined,
  key: string
): string | undefined {
  const value = record?.[key];

  return typeof value === "string" ? value : undefined;
}

function parseJsonObject(value: unknown): JsonObject {
  if (typeof value !== "string" || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolCallResource(
  input: JsonObject
): Pick<LocalAgentReportToolCall, "resource"> {
  const action = input.action;

  if (!isRecord(action) || !isRecord(action.resource)) {
    return {};
  }

  const path = action.resource.path;
  const id = action.resource.id;
  const type = action.resource.type;
  const value =
    typeof path === "string"
      ? path
      : typeof id === "string"
        ? id
        : typeof type === "string"
          ? type
          : undefined;

  return value === undefined ? {} : { resource: value };
}

function toolCallSummary(input: JsonObject): Pick<LocalAgentReportToolCall, "summary"> {
  const summary = input.summary;

  return typeof summary === "string" && summary.length > 0 ? { summary } : {};
}

function toolCallFailureInsight(input: {
  actionType: string;
  status: string;
  output: JsonObject;
}): Pick<
  LocalAgentReportToolCall,
  "failureKind" | "recoverable" | "failureExplanation"
> {
  if (input.status === "completed") {
    return {};
  }

  if (input.status === "approval_required") {
    return {
      failureKind: "approval_required",
      recoverable: true,
      failureExplanation:
        "Tool execution is paused for human approval; approve or deny the request, then resume the task."
    };
  }

  if (input.status === "denied") {
    return {
      failureKind: "policy_denied",
      recoverable: false,
      failureExplanation:
        "Runstead policy denied the action; change the task scope or policy before retrying."
    };
  }

  const message = toolCallFailureMessage(input.output).toLowerCase();

  if (
    input.actionType === "filesystem.patch" &&
    (message.includes("replacement search text not found") ||
      message.includes("replacement search text is ambiguous") ||
      message.includes("patch does not apply"))
  ) {
    return {
      failureKind: "harmless_patch_mismatch_retry",
      recoverable: true,
      failureExplanation:
        "Patch did not match current file contents; reread the file and retry with a narrower patch."
    };
  }

  if (
    message.includes("enoent") ||
    message.includes("no such file or directory") ||
    message.includes("not found")
  ) {
    return {
      failureKind: "missing_file",
      recoverable: true,
      failureExplanation:
        "The requested file or path was absent; this is usually recoverable by listing files or choosing a current path."
    };
  }

  if (message.length > 0) {
    return {
      failureKind: "tool_runtime_error",
      recoverable: true,
      failureExplanation:
        "The tool failed during execution; inspect the error, adjust the request, and retry if the task still needs it."
    };
  }

  return {
    failureKind: "unknown",
    recoverable: false,
    failureExplanation:
      "Runstead recorded a non-completed tool call without a structured error message."
  };
}

function toolCallFailureMessage(output: JsonObject): string {
  const error = output.error;
  const reason = output.reason;

  if (typeof error === "string") {
    return error;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  if (typeof reason === "string") {
    return reason;
  }

  return "";
}

function isVerifierReportRow(value: unknown): value is {
  verifier: string;
  exitCode?: number | string | null;
  timedOut?: boolean;
  evidenceId?: string;
} {
  return isRecord(value) && typeof value.verifier === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLocalAgentTask(task: Task): boolean {
  return task.type === LOCAL_AGENT_TASK_TYPE;
}

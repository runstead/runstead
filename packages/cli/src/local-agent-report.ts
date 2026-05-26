import { resolve } from "node:path";

import type { Goal, JsonObject, Task } from "@runstead/core";
import { openRunsteadDatabase, type RunsteadDatabase } from "@runstead/state-sqlite";

import { showGoal } from "./goals.js";
import { requireRunsteadStateDb } from "./runstead-root.js";
import { showTask } from "./tasks.js";

export {
  formatLocalAgentAuditSummary,
  formatLocalAgentTaskReport,
  formatLocalAgentTaskReportJson,
  formatLocalAgentTaskReportMarkdown,
  formatLocalAgentWarnings
} from "./local-agent-report-format.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLocalAgentTask(task: Task): boolean {
  return task.type === LOCAL_AGENT_TASK_TYPE;
}
